// Synthetic data only. Safe to re-run: existing rows are left untouched.
import type pg from 'pg';
import { hashPassword } from '../backend/src/lib/crypto.js';

export const DEMO_PASSWORD = 'Demo@12345';

export const DEMO_USERS = [
  { email: 'asha.applicant@example.test', name: 'Asha Verma (synthetic)', role: 'APPLICANT', region: 'NORTH' },
  { email: 'bilal.applicant@example.test', name: 'Bilal Khan (synthetic)', role: 'APPLICANT', region: 'NORTH' },
  { email: 'meera.operator@example.test', name: 'Meera Nair (Operator, North)', role: 'OPERATOR', region: 'NORTH' },
  { email: 'sam.operator@example.test', name: 'Sam Das (Operator, South)', role: 'OPERATOR', region: 'SOUTH' },
] as const;

type Req = [code: string, name: string, description: string, rules: object];
const identity: Req = ['IDENTITY_PROOF', 'Proof of identity', 'Photo identity document in your name.', { nameMustMatch: true }];
const address: Req = ['ADDRESS_PROOF', 'Proof of address', 'Issued within the last 3 months.', { nameMustMatch: true, maxAgeMonths: 3 }];
const birth: Req = ['BIRTH_PROOF', 'Proof of date of birth', 'Birth or school-leaving certificate.', { nameMustMatch: true }];
const oldPassport: Req = ['OLD_PASSPORT', 'Previous passport details', 'Reference page of your previous passport.', { nameMustMatch: true }];
const lossReport: Req = ['LOSS_REPORT', 'Loss or damage report', 'Report describing the loss or damage.', { maxAgeMonths: 6 }];

// Illustrative checklist rules for this assignment, not official passport requirements.
export const REQUIREMENTS: Array<{ type: string; scenario: string; items: Req[] }> = [
  { type: 'FRESH', scenario: 'STANDARD', items: [identity, address, birth] },
  { type: 'REISSUE', scenario: 'EXPIRING', items: [identity, address, oldPassport] },
  { type: 'REISSUE', scenario: 'LOST_OR_DAMAGED', items: [identity, address, lossReport] },
];

export async function seed(db: pg.Pool | pg.Client) {
  for (const user of DEMO_USERS) {
    await db.query(
      `INSERT INTO users (email, display_name, password_hash, role, region)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING`,
      [user.email, user.name, await hashPassword(DEMO_PASSWORD), user.role, user.region],
    );
  }
  for (const set of REQUIREMENTS) {
    for (const [index, [code, name, description, rules]] of set.items.entries()) {
      await db.query(
        `INSERT INTO document_requirements (application_type, scenario, code, name, description, rules, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (application_type, scenario, code) DO NOTHING`,
        [set.type, set.scenario, code, name, description, JSON.stringify(rules), index],
      );
    }
  }
}
