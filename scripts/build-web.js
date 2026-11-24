import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'styles.css']) cpSync(f, `www/${f}`);
for (const d of ['js', 'icons']) if (existsSync(d)) cpSync(d, `www/${d}`, { recursive: true });
console.log('www/ prêt');
