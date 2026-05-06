# হিসাব — Meal & Expense Manager

A complete, Firebase-powered meal and expense tracking web app. No backend server required — fully deployable on GitHub Pages.

---

## 📁 Project Structure

```
meal-expense-manager/
├── index.html              # Landing page (Admin / Member login buttons)
├── admin-login.html        # Admin login form
├── user-login.html         # Member login form (username-based)
├── admin-dashboard.html    # Admin panel (users, costs, calculation table)
├── user-dashboard.html     # Member panel (bazar, meals, summary)
├── firestore.rules         # Firebase security rules
└── js/
    ├── firebase-config.js  # Firebase init + exports
    ├── auth.js             # Login / logout / route guards
    ├── admin.js            # All admin dashboard logic
    ├── user.js             # All user dashboard logic
    └── calculation.js      # Pure calculation functions
```

---

## 🔧 Firebase Setup (Step-by-Step)

### Step 1 — Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `hisab-app`) → Continue
3. Disable Google Analytics (optional) → **Create project**

---

### Step 2 — Enable Authentication

1. In the Firebase console, go to **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method**, enable **Email/Password**
4. Click **Save**

---

### Step 3 — Create Firestore Database

1. Go to **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** → select a region → **Enable**

---

### Step 4 — Set Security Rules

1. Go to **Firestore → Rules** tab
2. Delete everything and paste the contents of `firestore.rules`
3. Click **Publish**

---

### Step 5 — Register a Web App & Get Config

1. Go to **Project Overview** (gear icon) → **Project settings**
2. Scroll to **Your apps** → click the **`</>`** (web) icon
3. Register app name (e.g. `hisab-web`) → **Register app**
4. Copy the `firebaseConfig` object
5. Open `js/firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

### Step 6 — Create the Admin Account

The admin is created manually through Firebase console:

1. Go to **Authentication → Users → Add user**
2. Enter admin email (e.g. `admin@hisab.app`) and a strong password
3. Click **Add user** — copy the UID shown

4. Go to **Firestore → Data → + Start collection**
   - Collection ID: `users`
   - Document ID: paste the admin UID from step 3
   - Add fields:
     ```
     name       (string)  → Your Name
     username   (string)  → admin
     phone      (string)  → 01XXXXXXXXX
     role       (string)  → admin
     createdAt  (timestamp) → (click timestamp, use today)
     ```
5. Click **Save**

Now you can log in at `admin-login.html` using the email and password from step 1.

---

### Step 7 — Add Members via Admin Dashboard

Once logged in as admin:
1. Click **Add Member** in the sidebar
2. Fill in Name, Username, Password, Phone
3. Click **Create Member**

The member can then log in at `user-login.html` using their **username** (not email).

---

## 🚀 Deployment to GitHub Pages

### Step 1 — Create GitHub Repository

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hisab.git
git push -u origin main
```

### Step 2 — Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings → Pages**
3. Under **Source**, select **Deploy from a branch**
4. Choose branch: `main`, folder: `/ (root)`
5. Click **Save**

Your app will be live at:
`https://YOUR_USERNAME.github.io/hisab/`

### Step 3 — Add GitHub Pages Domain to Firebase

1. Go to Firebase Console → Authentication → Settings → **Authorized domains**
2. Click **Add domain**
3. Enter: `YOUR_USERNAME.github.io`
4. Click **Add**

Without this step, Firebase auth will be blocked on your GitHub Pages URL.

---

## 💡 How It Works

### Authentication Flow

| Role  | Login Page        | Credentials         | Firebase Email           |
|-------|-------------------|---------------------|--------------------------|
| Admin | admin-login.html  | Email + Password    | actual email             |
| User  | user-login.html   | Username + Password | username@hisab.local     |

Usernames are converted to fake emails internally:
`masud` → `masud@hisab.local`

### Calculation Logic

```
mealRate      = totalBazar (all users) / totalMeals (all users)
mealCost      = userMeals × mealRate
khalaPerPerson = khalaTotal / activeUsers
gasPerPerson   = gasTotal / activeUsers
electricityPerPerson = electricityTotal / activeUsers
wifiPerPerson  = wifiTotal / activeUsers
bariVara       = saved person-wise rent entered by admin

totalPayable = mealCost + khalaPerPerson + gasPerPerson
             + electricityPerPerson + wifiPerPerson + bariVara
```

### Meal Units

- `1` = full meal
- `0.5` = half meal
- `0` = no meal

---

## 🔒 Security Rules Summary

| Collection   | User Access                         | Admin Access     |
|--------------|-------------------------------------|------------------|
| users        | Read own profile                    | Full read/write  |
| bazar        | Read/write own entries              | Full read/write  |
| meals        | Read/write own entries              | Full read/write  |
| months       | Read only (for their calculation)   | Full read/write  |
| rentSplits   | Read own                            | Full read/write  |

---

## 📦 Dependencies (CDN — No npm needed)

| Library              | Version | Purpose              |
|----------------------|---------|----------------------|
| Bootstrap 5          | 5.3.3   | UI framework         |
| Bootstrap Icons      | 1.11.3  | Icons                |
| Firebase JS SDK      | 10.12.2 | Auth + Firestore     |
| jsPDF                | 2.5.1   | PDF generation       |
| jsPDF-AutoTable      | 3.8.2   | PDF table layout     |
| Google Fonts         | —       | Typography           |

All loaded via CDN. No build step required.

---

## ❓ Troubleshooting

| Problem | Solution |
|---|---|
| Login fails on GitHub Pages | Add your GitHub Pages domain to Firebase authorized domains |
| "Permission denied" errors | Double-check firestore.rules are published correctly |
| Admin can't see users | Make sure admin Firestore doc has `role: "admin"` |
| Users can't log in | Username must be lowercase, no spaces. Password min 6 chars |
| PDF not exporting | Ensure jsPDF CDN scripts load (check browser console) |

---

## 🗺️ Roadmap / Future Improvements

- [ ] Meal entry edit / delete for users
- [ ] Admin can delete bazar entries
- [ ] Month-to-month carry over
- [ ] Push notifications for due payments
- [ ] Mobile PWA support

---

Built with ❤️ using Firebase + Bootstrap 5
