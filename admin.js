const bcrypt = require('bcryptjs');
const { initialize, one, run } = require('./server');

function readPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) return reject(new Error('Run this command in an interactive terminal.'));
    process.stdout.write('Admin password (10+ characters): ');
    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (character) => {
      if (character === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        reject(new Error('Cancelled.'));
      } else if (character === '\r' || character === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (character === '\u007f' || character === '\b') {
        password = password.slice(0, -1);
      } else if (character >= ' ') {
        password += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [email, username] = process.argv.slice(2);
  if (!email || !username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    throw new Error('Usage: node admin.js <email> <username>');
  }
  const password = await readPassword();
  if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Password must contain 10+ characters, uppercase, lowercase, a number, and a symbol.');
  }
  await initialize();
  const hash = await bcrypt.hash(password, 12);
  const existing = one('SELECT id FROM users WHERE email=? OR username=?', [email.toLowerCase(), username]);
  if (existing) run('UPDATE users SET username=?,email=?,password_hash=?,role=? WHERE id=?', [username, email.toLowerCase(), hash, 'admin', existing.id]);
  else run('INSERT INTO users (full_name,username,email,phone,country,password_hash,role) VALUES (?,?,?,?,?,?,?)', ['Atlas Administrator', username, email.toLowerCase(), 'Not provided', 'Not provided', hash, 'admin']);
  console.log(`Administrator account ready for ${email.toLowerCase()}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
