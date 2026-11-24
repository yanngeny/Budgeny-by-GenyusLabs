package com.genyuslabs.budgeny;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Accès au fichier JSON via le Storage Access Framework (téléphone, Google Drive, etc.)
 * + ouverture d'une URL dans le navigateur sans déclencher l'appli de la banque.
 */
@CapacitorPlugin(name = "BudgenyFile")
public class BudgenyFilePlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        boolean create = Boolean.TRUE.equals(call.getBoolean("create", false));
        Intent i;
        if (create) {
            i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Budgeny_data.json"));
            i.setType("application/json");
        } else {
            i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.setType("*/*");
        }
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
        }
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", displayName(uri));
        call.resolve(o);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) {
            call.reject("uri manquant");
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(s))) {
            if (in == null) {
                call.reject("Lecture impossible");
                return;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSObject o = new JSObject();
            o.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Lecture impossible : " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String s = call.getString("uri");
        String text = call.getString("text");
        if (s == null || text == null) {
            call.reject("paramètres manquants");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(Uri.parse(s), "wt")) {
            if (out == null) {
                call.reject("Écriture impossible");
                return;
            }
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Écriture impossible : " + e.getMessage());
        }
    }

    /**
     * Ouvre l'URL directement dans le navigateur par défaut (package forcé), pour que
     * l'appli de la banque, si elle est installée, ne capte pas le lien.
     */
    @PluginMethod
    public void openBrowser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("URL invalide");
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com"));
        probe.addCategory(Intent.CATEGORY_BROWSABLE);
        ResolveInfo ri = getContext().getPackageManager()
                .resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY);
        if (ri != null && ri.activityInfo != null && !"android".equals(ri.activityInfo.packageName)) {
            view.setPackage(ri.activityInfo.packageName);
        }
        try {
            getContext().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            view.setPackage(null);
            try {
                getContext().startActivity(view);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Ouverture impossible : " + e2.getMessage());
            }
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return "Budgeny_data.json";
    }
}
