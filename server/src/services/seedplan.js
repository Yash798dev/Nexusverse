// seedplan.js — creates or updates the subscription plans shown on the Pricing page.
// Run with: npm run seed:plans
//
// Plans are upserted by name rather than deleted and re-inserted, so existing plan
// ids (used by POST /api/subscription/:planId) stay valid when you re-run this.
require('dotenv').config();
const mongoose = require('mongoose');

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
const Plan = require('../models/Plan');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set — add it to server/.env');
  process.exit(1);
}

const { COST_PER_VIDEO: CREDITS_PER_VIDEO } = require('../config/credits');

const plans = [
  {
    name: 'Starter',
    price: 9,
    credits: 500,
    durationDays: 30,
    pitch: 'Try the full autonomous pipeline — script, visuals, voice, captions and upload.',
  },
  {
    name: 'Creator',
    price: 19,
    credits: 1500,
    durationDays: 30,
    pitch: 'A published video every day for a growing channel.',
  },
  {
    name: 'Pro Studio',
    price: 49,
    credits: 5000,
    durationDays: 30,
    pitch: 'Several Shorts a day with room to re-run and refine.',
  },
  {
    name: 'Agency',
    price: 99,
    credits: 12500,
    durationDays: 30,
    pitch: 'Run multiple channels from one studio.',
  },
].map(({ pitch, ...plan }) => ({
  ...plan,
  description: `${pitch} About ${Math.floor(plan.credits / CREDITS_PER_VIDEO)} videos a month.`,
}));

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log("Connected to DB");

    for (const plan of plans) {
      await Plan.findOneAndUpdate({ name: plan.name }, plan, { upsert: true, runValidators: true });
      console.log(`  ✓ ${plan.name}: $${plan.price}/month, ${plan.credits} credits`);
    }

    console.log(`Plans seeded (${plans.length})`);
    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  });
