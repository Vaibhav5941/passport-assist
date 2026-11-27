# Laptop par kaise chalayein (step by step)

## 1. Yeh 2 cheezein install karein
| Tool | Kahan se | Check |
|---|---|---|
| Node.js 22 LTS (kam se kam 20.12) | https://nodejs.org | `node -v` |
| Docker Desktop (PostgreSQL ke liye) | https://www.docker.com/products/docker-desktop/ | `docker -v` |

Install ke baad **Docker Desktop kholkar chalu rakhein**.

## 2. Project kholein
ZIP ko extract karein. `passport-assist` folder VS Code me kholein, phir Terminal > New Terminal.
`package.json` isi folder me dikhna chahiye.

## 3. Pehli baar ka setup (ek hi baar)
```
npm ci
npm run db:up
npm run setup
```
- `npm ci`: libraries install karta hai (internet chahiye).
- `db:up`: Docker me PostgreSQL chalu karta hai (port 5433).
- `setup`: `.env` banata hai (random secrets ke saath), tables banata hai, demo data daalta hai.

## 4. App chalayein
```
npm run dev
```
Browser me kholein: **http://localhost:5173**. Band karne ke liye terminal me `Ctrl + C`.

Agli baar sirf: Docker Desktop kholein, `npm run db:up`, `npm run dev`.

## 5. Tests chalayein
```
npm test
```
Expected: `Tests 58 passed (58)`. Tests alag database `passport_test` use karte hain, isliye demo data safe rehta hai.

## 6. Demo accounts (password sabka `Demo@12345`)
| Email | Role |
|---|---|
| asha.applicant@example.test | Applicant A |
| bilal.applicant@example.test | Applicant B |
| meera.operator@example.test | Operator, North (Asha/Bilal ki applications dikhti hain) |
| sam.operator@example.test | Operator, South (kuch nahi dikhta, scope demo ke liye) |

Do users ek saath dikhane ke liye ek normal window aur ek Incognito window use karein.

## 7. Demo flow (viva / review ke liye)
1. Asha: Profile bharein. **Name `Asha Verma` rakhein**.
2. Home > Create application > **Start document collection**.
3. Checklist > Review consent > Give consent.
4. DigiLocker screen par **"simulate provider outage"** tick karein > Connect. "Provider unavailable" aayega. Untick karein > Retry.
5. Allow access > identity aur **old** utility statement select karein > Link. Address **Rejected** hoga, reason ke saath.
6. Consent page > Withdraw consent. DigiLocker documents hat jayenge.
7. Har item me **Upload instead** (koi bhi nakli PDF/JPG/PNG, 2 MB tak, issue date aaj ki). Asli document upload na karein.
8. Checklist > Send for review.
9. Meera: Queue > Open > Start review > ek document Reject (reason) > Request corrections.
10. Asha: Notifications dekhein > rejected document dobara upload > Resend for review.
11. Meera: Start review > teeno Accept > Mark submitted (simulated) > Audit trail.
12. Asha: Tracking timeline (phone view: browser DevTools > device toolbar).

### Scenario 4 aur 7 dikhana
UI galat button dikhata hi nahi, isliye backend ka proof test se dein:
```
npm test
```
`backend/tests/workflow.test.ts` me "scenario 4" aur "scenario 7" dekhein.
Live demo ke liye: Bilal se login karke Asha ki application ka URL paste karein. "The requested item was not found." aayega.

Scenario 2 (duplicate callback) aur 5 (dusra device) bhi isi test file me hain.

## 8. Problem aaye to
| Problem | Solution |
|---|---|
| `docker: command not found` ya `cannot connect to the Docker daemon` | Docker Desktop install/chalu karein |
| `ECONNREFUSED ...5433` | `npm run db:up` chalayein |
| `Port 5173 is already in use` / `EADDRINUSE 4000` | Purana terminal band karein |
| `password authentication failed` | `docker compose down -v` phir `npm run db:up` aur `npm run setup` (**demo database delete hoga**) |
| Demo shuru se karna hai | `docker compose down -v`, `npm run db:up`, `npm run setup` |

### Docker ke bina
Apne laptop par PostgreSQL 16 install karein, phir `psql` me:
```sql
CREATE USER passport WITH PASSWORD 'passport_local_only' CREATEDB;
CREATE DATABASE passport OWNER passport;
```
`npm run setup` se pehle `node scripts/init-env.mjs` chalayein, `.env` me dono jagah `5433` ko `5432` karein, phir `npm run setup`. `db:up` ki zarurat nahi.

> Note: Yeh project Linux par PostgreSQL 16 ke saath test hua hai. Docker Compose wala raasta aur Windows/macOS abhi test nahi hue hain.
