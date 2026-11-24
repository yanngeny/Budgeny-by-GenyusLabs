// À lancer APRÈS `npx cap add android` : installe le plugin natif et patche le manifeste.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const pkgDir = 'android/app/src/main/java/com/genyuslabs/budgeny';
mkdirSync(pkgDir, { recursive: true });
for (const f of ['BudgenyFilePlugin.java', 'MainActivity.java']) {
  copyFileSync(`native/android/${f}`, `${pkgDir}/${f}`);
}

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let xml = readFileSync(manifestPath, 'utf8');
if (!xml.includes('<queries>')) {
  const queries =
    '<queries><intent><action android:name="android.intent.action.VIEW"/>' +
    '<category android:name="android.intent.category.BROWSABLE"/>' +
    '<data android:scheme="https"/></intent></queries>\n    <application';
  xml = xml.replace('<application', queries);
  writeFileSync(manifestPath, xml);
}
console.log('Plugin Android installé');
