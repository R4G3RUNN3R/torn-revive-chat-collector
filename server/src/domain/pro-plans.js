const PRO_PLANS = Object.freeze({
  monthly: Object.freeze({ id:'monthly', months:1, xanax:10, cash:10000000 }),
  six_months: Object.freeze({ id:'six_months', months:6, xanax:55, cash:55000000 }),
  yearly: Object.freeze({ id:'yearly', months:12, xanax:100, cash:100000000 })
});

const PRO_PLAN_LABELS = Object.freeze({
  monthly:'Monthly',
  six_months:'6 Months',
  yearly:'Yearly'
});

function publicProPlans() {
  return Object.values(PRO_PLANS).map(plan => ({
    id:plan.id,
    label:PRO_PLAN_LABELS[plan.id],
    months:plan.months,
    xanax:plan.xanax,
    cash:plan.cash
  }));
}

function getProPlan(planId) {
  const plan = typeof planId === 'string' ? PRO_PLANS[planId] : null;
  if (!plan) throw new Error('UNKNOWN_PRO_PLAN');
  return plan;
}

function amountForCurrency(plan, currency) {
  if (!plan || !Object.values(PRO_PLANS).includes(plan)) throw new Error('UNKNOWN_PRO_PLAN');
  if (currency !== 'xanax' && currency !== 'cash') throw new Error('UNKNOWN_PRO_CURRENCY');
  return plan[currency];
}

function extendCalendarDuration(base, months) {
  if (!(base instanceof Date) || Number.isNaN(base.getTime())) throw new Error('INVALID_BASE_DATE');
  if (!Number.isInteger(months) || months <= 0) throw new Error('INVALID_MONTH_COUNT');

  const result = new Date(base.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const targetYear = result.getUTCFullYear();
  const targetMonth = result.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

module.exports = {
  PRO_PLANS,
  PRO_PLAN_LABELS,
  publicProPlans,
  getProPlan,
  amountForCurrency,
  extendCalendarDuration
};
