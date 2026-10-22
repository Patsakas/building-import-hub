// Creates a confirmed user account with a generated password. Public sign-up is disabled, so this
// is how people get access. Run by an operator; the secret key is passed in, never stored.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//     deno run --allow-net --allow-env --allow-write scripts/provision-user.ts <email> <output-file>
//
// The password is written only to <output-file> (never printed), so it stays out of terminal
// scrollback and logs. Send it to the user through a separate channel, then delete the file.

const [email, outputFile] = Deno.args;
const url = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
const secretKey = Deno.env.get("SUPABASE_SECRET_KEY");

if (!email || !outputFile || !url || !secretKey) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... provision-user.ts <email> <file>");
  Deno.exit(2);
}

// 24 characters from an alphabet without look-alikes (0/O, 1/l/I): about 137 bits of entropy.
function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length); // reject biased bytes
  const chars: string[] = [];
  while (chars.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && chars.length < length) chars.push(alphabet[byte % alphabet.length]!);
    }
  }
  return chars.join("");
}

const password = generatePassword();
const response = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: secretKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const body = await response.json();

if (!response.ok) {
  console.error(`Could not create ${email}: ${body.msg ?? body.message ?? response.statusText}`);
  Deno.exit(1);
}

await Deno.writeTextFile(
  outputFile,
  `Buildings Registry login\nEmail: ${email}\nPassword: ${password}\n`,
  { mode: 0o600, createNew: true },
);
console.log(`Created confirmed user ${email} (${body.id}). Credentials written to ${outputFile}.`);
