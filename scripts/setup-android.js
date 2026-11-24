// À lancer APRÈS `npx cap add android` : installe le plugin natif et patche le manifeste.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';

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
    '<data android:scheme="https"/></intent>' +
    '<package android:name="com.boursorama.android.clients"/></queries>\n    <application';
  xml = xml.replace('<application', queries);
  writeFileSync(manifestPath, xml);
}
// Icône de l'appli (logo lampe + anneau 50-30-20) : adaptative (Android 8+) et PNG de secours.
cpSync('native/android/res', 'android/app/src/main/res', { recursive: true });

console.log('Plugin Android et icône installés');
