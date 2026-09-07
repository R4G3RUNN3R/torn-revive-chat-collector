const RETAINED_ACCOUNT_HISTORY = Object.freeze([
  'billing_history',
  'payment_reuse_protection',
  'security_audit_history'
]);
const DELETED_ACCOUNT_NAME = 'Deleted ReviveRelay account';

function assertDate(value, code) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(code);
}

async function deleteAccount(pool,{userId,now=new Date()}) {
  if (typeof userId!=='string' || !userId.trim()) throw new Error('ACCOUNT_USER_ID_REQUIRED');
  assertDate(now,'INVALID_ACCOUNT_DELETE_DATE');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const locked=await client.query(`
      SELECT id,account_state
      FROM users
      WHERE id=$1
      FOR UPDATE
    `,[userId]);
    if (locked.rowCount!==1) throw new Error('ACCOUNT_NOT_FOUND');

    await client.query(`
      UPDATE revive_requests
      SET state='CANCELLED',
          cancelled_at=COALESCE(cancelled_at,$2),
          closed_at=COALESCE(closed_at,$2),
          updated_at=$2
      WHERE requester_id=$1
        AND closed_at IS NULL
        AND state='AVAILABLE'
    `,[userId,now]);

    await client.query(`
      UPDATE pro_invoices
      SET state='CANCELLED',
          updated_at=$2
      WHERE user_id=$1
        AND state='PENDING'
    `,[userId,now]);

    await client.query('DELETE FROM api_credentials WHERE user_id=$1',[userId]);
    await client.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
    await client.query('DELETE FROM revivers WHERE user_id=$1',[userId]);
    await client.query('DELETE FROM error_occurrences WHERE user_id=$1',[userId]);

    await client.query(`
      UPDATE users
      SET current_name=$2,
          account_state='deleted',
          updated_at=$3
      WHERE id=$1
    `,[userId,DELETED_ACCOUNT_NAME,now]);

    await client.query(`
      INSERT INTO audit_events (
        actor_type,actor_id,entity_type,entity_id,action,details,created_at
      ) VALUES ('user',NULL,'user',$1,'account.deleted',$2::jsonb,$3)
    `,[userId,JSON.stringify({retained:RETAINED_ACCOUNT_HISTORY}),now]);

    await client.query('COMMIT');
    return {deleted:true,retained:[...RETAINED_ACCOUNT_HISTORY]};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createAccountDeletionService(pool) {
  if (!pool || typeof pool.connect!=='function') throw new Error('PostgreSQL pool is required');
  return Object.freeze({
    deleteAccount(input){return deleteAccount(pool,input);}
  });
}

module.exports={
  RETAINED_ACCOUNT_HISTORY,
  DELETED_ACCOUNT_NAME,
  deleteAccount,
  createAccountDeletionService
};
