/**
 * Set (or reset) the seeded admin's password. Run:
 *   npm run admin:password -- admin@psdlimo.demo 'a-strong-password'
 *
 * The password is bcrypt-hashed before it touches the DB — plaintext is never
 * stored. Used to give the demo admin a real login.
 */

import { setUserPassword } from "@/lib/users";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("\nUsage: npm run admin:password -- <email> <password>\n");
  process.exit(1);
}
if (password.length < 8) {
  console.error("\n✖ Password must be at least 8 characters.\n");
  process.exit(1);
}

setUserPassword(email, password)
  .then((ok) => {
    if (ok) {
      console.log(`\n✓ Password set for ${email}\n`);
    } else {
      console.error(`\n✖ No user found with email ${email}. Run db:seed first.\n`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("\n✖ Failed:", err);
    process.exit(1);
  });
