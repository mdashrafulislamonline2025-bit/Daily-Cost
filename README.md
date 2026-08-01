# Expense Manager

A single-employee expense tracking web app — HTML, CSS, vanilla JavaScript, and Firebase (Authentication, Firestore, Storage). Material Design 3 styling with light/dark mode, built for Firebase Hosting.

## Files

| File | Purpose |
|---|---|
| `index.html` | Entry point — redirects to `dashboard.html` or `login.html` based on auth state |
| `login.html` | Email/password sign in |
| `dashboard.html` | Summary cards, expense pie chart, monthly bar chart, recent transactions |
| `payments.html` | Add / edit / view company payments |
| `expenses.html` | Add / edit / view expenses |
| `voucher.html` | Upload voucher images, manage voucher status |
| `transactions.html` | Full searchable, sortable, filterable transaction table |
| `reports.html` | Daily / weekly / monthly / custom reports, export to PDF, Excel, CSV |
| `settings.html` | Dark mode, currency, profile, backup & restore |
| `style.css` | All styling — design tokens, light/dark themes, components |
| `script.js` | All application logic (single module, routed by `<body data-page="...">`) |
| `firebase.js` | Firebase initialization — **put your project config here** |
| `firestore.rules` | Firestore security rules |
| `storage.rules` | Storage security rules (voucher images) |
| `firebase.json` | Firebase Hosting configuration |

## 1. Create your Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. Enable **Authentication** → Sign-in method → **Email/Password**.
3. Enable **Firestore Database** (start in production mode — the included rules lock it down).
4. Enable **Storage** (for voucher image uploads).
5. In **Project Settings → General → Your apps**, add a **Web app** and copy the `firebaseConfig` object.

## 2. Connect the app to your project

Open `firebase.js` and replace the placeholder values with your real config:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

## 3. Create your login

This app has no public sign-up screen (it's built for one employee). Create the account yourself:

- Firebase Console → Authentication → Users → **Add user** → enter the employee's email & password.

## 4. Deploy the security rules

Using the [Firebase CLI](https://firebase.google.com/docs/cli):

```bash
npm install -g firebase-tools
firebase login
firebase init      # choose Hosting + Firestore + Storage, select your existing project
firebase deploy --only firestore:rules,storage:rules
```

(The included `firestore.rules` and `storage.rules` already do what you need — you can skip `firebase init`'s rule-creation prompts and just point it at these files.)

## 5. Deploy to Firebase Hosting

```bash
firebase deploy --only hosting
```

Your app will be live at `https://YOUR_PROJECT_ID.web.app`.

## Data model (Firestore)

```
payments/{id}   { amount, date, method, note, uid, createdAt }
expenses/{id}   { amount, category, date, description, voucherAvailable, uid, createdAt }
vouchers/{id}   { amount, date, category, status, imageUrl, uid, createdAt }
```

`status` for vouchers is one of: `Pending`, `Submitted`, `Approved`, `Rejected`.

## Dashboard formulas

- **Current Balance** = Total Received − Total Expenses
- **Voucher Pending** = sum of vouchers where `status = Pending`
- **Voucher Submitted** = sum of vouchers where `status = Submitted`
- **Company Due** = Voucher Submitted total − payments where `method = Reimbursement`

## Notes

- All data is live-synced via Firestore `onSnapshot` listeners — no manual refresh needed anywhere in the app.
- Currency is fixed to Bangladeshi Taka (৳) per the brief; change `CURRENCY_SYMBOL` in `script.js` if you need another currency.
- Reports export via CSV (built-in), Excel (SheetJS, loaded from CDN in `reports.html`), and PDF (jsPDF + AutoTable, loaded from CDN in `reports.html`).
- Everything runs as native ES modules — no build step, no bundler. Just static files.
