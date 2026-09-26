// Billing engine: calculates utility charges based on tariffs and meter readings
// Supports interval approach when tariff changes mid-month (Principle 1)
const { round2 } = require('./utils');

function calculateElectricity(consumption, tariff) {
  const c = Number(consumption) || 0;
  const t1 = Number(tariff.electricity_tariff1) || 0;
  const t2 = Number(tariff.electricity_tariff2) || 0;
  const t3 = Number(tariff.electricity_tariff3) || 0;
  const th1 = Number(tariff.electricity_threshold1) || 150;
  const th2 = Number(tariff.electricity_threshold2) || 800;

  if (t1 === 0 && t2 === 0 && t3 === 0) return 0;

  let sum;
  if (c <= th1) {
    sum = c * t1;
  } else if (c <= th2) {
    sum = th1 * t1 + (c - th1) * t2;
  } else {
    sum = th1 * t1 + (th2 - th1) * t2 + (c - th2) * t3;
  }
  return round2(sum);
}

function calculateSimple(consumption, tariffRate) {
  return round2((Number(consumption) || 0) * (Number(tariffRate) || 0));
}

// Calculate fixed charges (TKO, UK, caprepair, rent) for a given tariff and flat
function calculateFixed(tariff, flat) {
  const breakdown = {};
  breakdown.tko = { amount: round2(Number(tariff?.tko) || 0) };
  breakdown.uk = { amount: round2(Number(tariff?.uk) || 0) };
  breakdown.caprepair = { amount: round2(Number(tariff?.caprepair) || 0) };
  breakdown.rent = { amount: 0 };
  if (flat && flat.rent_enabled) {
    breakdown.rent = { amount: round2(Number(flat.rent_amount) || 0) };
  }
  return breakdown;
}

// Simple accrual: single reading, single tariff (normal month)
function calculateAccrual(readings, prevReadings, tariff, flat) {
  const breakdown = {};

  const elecConsumption = (Number(readings.electricity) || 0) - (Number(prevReadings.electricity) || 0);
  breakdown.electricity = {
    consumption: round2(Math.max(0, elecConsumption)),
    amount: calculateElectricity(Math.max(0, elecConsumption), tariff),
  };

  const waterConsumption = (Number(readings.water) || 0) - (Number(prevReadings.water) || 0);
  breakdown.water = {
    consumption: round2(Math.max(0, waterConsumption)),
    amount: calculateSimple(Math.max(0, waterConsumption), tariff.water),
  };

  const gasConsumption = (Number(readings.gas) || 0) - (Number(prevReadings.gas) || 0);
  breakdown.gas = {
    consumption: round2(Math.max(0, gasConsumption)),
    amount: calculateSimple(Math.max(0, gasConsumption), tariff.gas),
  };

  const fixed = calculateFixed(tariff, flat);
  breakdown.tko = fixed.tko;
  breakdown.uk = fixed.uk;
  breakdown.caprepair = fixed.caprepair;
  breakdown.rent = fixed.rent;

  const total = round2(
    breakdown.electricity.amount +
    breakdown.water.amount +
    breakdown.gas.amount +
    breakdown.tko.amount +
    breakdown.uk.amount +
    breakdown.caprepair.amount +
    breakdown.rent.amount
  );

  return { breakdown, total };
}

// Interval accrual: multiple readings in a month with tariff change
// allReadings: array of reading records ordered by submitted_at ASC
// getTariffForDate: function(dateStr) → tariff record
function calculateIntervalAccrual(allReadings, prevMonthReadings, getTariffForDate, flat) {
  const breakdown = {
    electricity: { consumption: 0, amount: 0 },
    water: { consumption: 0, amount: 0 },
    gas: { consumption: 0, amount: 0 },
  };

  if (!allReadings || allReadings.length === 0) {
    // No readings → variables = 0, only fixed charges
    const tariffForFirst = getTariffForDate(null);
    const fixed = calculateFixed(tariffForFirst, flat);
    breakdown.tko = fixed.tko;
    breakdown.uk = fixed.uk;
    breakdown.caprepair = fixed.caprepair;
    breakdown.rent = fixed.rent;
    const total = round2(
      breakdown.tko.amount + breakdown.uk.amount +
      breakdown.caprepair.amount + breakdown.rent.amount
    );
    return { breakdown, total };
  }

  if (allReadings.length === 1) {
    // Single reading in interval month: entire consumption by tariff on reading date
    const r = allReadings[0];
    const tariff = getTariffForDate(r.submitted_at);

    const elecConsumption = (Number(r.electricity) || 0) - (Number(prevMonthReadings.electricity) || 0);
    breakdown.electricity = {
      consumption: round2(Math.max(0, elecConsumption)),
      amount: calculateElectricity(Math.max(0, elecConsumption), tariff),
    };

    const waterConsumption = (Number(r.water) || 0) - (Number(prevMonthReadings.water) || 0);
    breakdown.water = {
      consumption: round2(Math.max(0, waterConsumption)),
      amount: calculateSimple(Math.max(0, waterConsumption), tariff.water),
    };

    const gasConsumption = (Number(r.gas) || 0) - (Number(prevMonthReadings.gas) || 0);
    breakdown.gas = {
      consumption: round2(Math.max(0, gasConsumption)),
      amount: calculateSimple(Math.max(0, gasConsumption), tariff.gas),
    };

    const fixed = calculateFixed(tariff, flat);
    breakdown.tko = fixed.tko;
    breakdown.uk = fixed.uk;
    breakdown.caprepair = fixed.caprepair;
    breakdown.rent = fixed.rent;

    const total = round2(
      breakdown.electricity.amount + breakdown.water.amount + breakdown.gas.amount +
      breakdown.tko.amount + breakdown.uk.amount + breakdown.caprepair.amount + breakdown.rent.amount
    );
    return { breakdown, total };
  }

  // Multiple readings: calculate consumption per interval
  // Each interval uses the tariff of the later (right boundary) reading date
  let prevElec = Number(prevMonthReadings.electricity) || 0;
  let prevWater = Number(prevMonthReadings.water) || 0;
  let prevGas = Number(prevMonthReadings.gas) || 0;

  let totalElecConsumption = 0;
  let totalElecAmount = 0;
  let totalWaterConsumption = 0;
  let totalWaterAmount = 0;
  let totalGasConsumption = 0;
  let totalGasAmount = 0;

  for (let i = 0; i < allReadings.length; i++) {
    const r = allReadings[i];
    const tariff = getTariffForDate(r.submitted_at);

    const elecConsumption = Math.max(0, (Number(r.electricity) || 0) - prevElec);
    const waterConsumption = Math.max(0, (Number(r.water) || 0) - prevWater);
    const gasConsumption = Math.max(0, (Number(r.gas) || 0) - prevGas);

    totalElecConsumption += elecConsumption;
    totalElecAmount += calculateElectricity(elecConsumption, tariff);
    totalWaterConsumption += waterConsumption;
    totalWaterAmount += calculateSimple(waterConsumption, tariff.water);
    totalGasConsumption += gasConsumption;
    totalGasAmount += calculateSimple(gasConsumption, tariff.gas);

    prevElec = Number(r.electricity) || prevElec;
    prevWater = Number(r.water) || prevWater;
    prevGas = Number(r.gas) || prevGas;
  }

  breakdown.electricity = { consumption: round2(totalElecConsumption), amount: round2(totalElecAmount) };
  breakdown.water = { consumption: round2(totalWaterConsumption), amount: round2(totalWaterAmount) };
  breakdown.gas = { consumption: round2(totalGasConsumption), amount: round2(totalGasAmount) };

  // Fixed charges: use tariff of the last reading date
  const lastTariff = getTariffForDate(allReadings[allReadings.length - 1].submitted_at);
  const fixed = calculateFixed(lastTariff, flat);
  breakdown.tko = fixed.tko;
  breakdown.uk = fixed.uk;
  breakdown.caprepair = fixed.caprepair;
  breakdown.rent = fixed.rent;

  const total = round2(
    breakdown.electricity.amount + breakdown.water.amount + breakdown.gas.amount +
    breakdown.tko.amount + breakdown.uk.amount + breakdown.caprepair.amount + breakdown.rent.amount
  );

  return { breakdown, total };
}

// Calculate fixed-only accrual (for auto-accrual on 23rd when no readings)
function calculateFixedOnlyAccrual(tariff, flat) {
  const fixed = calculateFixed(tariff, flat);
  const total = round2(
    fixed.tko.amount + fixed.uk.amount + fixed.caprepair.amount + fixed.rent.amount
  );
  return { breakdown: fixed, total };
}

function buildAccrualDescription(breakdown) {
  const lines = [];
  if (breakdown.electricity && breakdown.electricity.amount > 0)
    lines.push(`Электричество: ${breakdown.electricity.consumption} кВт·ч = ${breakdown.electricity.amount} руб.`);
  if (breakdown.water && breakdown.water.amount > 0)
    lines.push(`Вода: ${breakdown.water.consumption} м³ = ${breakdown.water.amount} руб.`);
  if (breakdown.gas && breakdown.gas.amount > 0)
    lines.push(`Газ: ${breakdown.gas.consumption} м³ = ${breakdown.gas.amount} руб.`);
  if (breakdown.tko && breakdown.tko.amount > 0)
    lines.push(`ТКО: ${breakdown.tko.amount} руб.`);
  if (breakdown.uk && breakdown.uk.amount > 0)
    lines.push(`УК: ${breakdown.uk.amount} руб.`);
  if (breakdown.caprepair && breakdown.caprepair.amount > 0)
    lines.push(`Капремонт: ${breakdown.caprepair.amount} руб.`);
  if (breakdown.rent && breakdown.rent.amount > 0)
    lines.push(`Аренда: ${breakdown.rent.amount} руб.`);
  return lines.join('\n');
}

module.exports = {
  calculateElectricity,
  calculateSimple,
  calculateFixed,
  calculateAccrual,
  calculateIntervalAccrual,
  calculateFixedOnlyAccrual,
  buildAccrualDescription,
};
