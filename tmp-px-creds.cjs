const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const grab = (k) => {
  const q = env.match(new RegExp('^' + k + '="([\\s\\S]*?)"', 'm'));
  if (q) return q[1];
  const p = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return p ? p[1].trim() : '';
};
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: grab('FIREBASE_PROJECT_ID'),
    clientEmail: grab('FIREBASE_CLIENT_EMAIL'),
    privateKey: grab('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }),
});
Promise.all([
  admin.auth().listUsers(20),
  admin.firestore().collection('users').get(),
]).then(([u, d]) => {
  console.log('AUTH USERS:');
  u.users.forEach((x) => console.log(' ', x.uid, x.email, x.metadata.creationTime));
  console.log('USERS COLLECTION:');
  d.forEach((x) => { const v = x.data(); console.log(' ', x.id, v.email, v.role); });
  process.exit(0);
}).catch((e) => { console.error('ERR', e.message); process.exit(1); });
