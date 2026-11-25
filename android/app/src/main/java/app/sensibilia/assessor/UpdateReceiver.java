package app.sensibilia.assessor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * The result of a self-update, and the restart after it. Not exported: only this app
 * (the PackageInstaller result) and the system (MY_PACKAGE_REPLACED) deliver here.
 */
public class UpdateReceiver extends BroadcastReceiver {
    static final String ACTION_RESULT = "app.sensibilia.assessor.UPDATE_RESULT";
    private static final String FILE = "update";
    private static final String PROBLEM = "problem";

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            // Updated: start again (as device owner and home app this is allowed from here).
            context.startActivity(new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return;
        }
        if (!ACTION_RESULT.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Not device owner: Android asks staff to confirm.
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            return;
        }
        String problem = Updater.problem(
                status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        if (problem != null) {
            context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
                    .edit().putString(PROBLEM, problem).apply();
            context.startActivity(new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        }
    }

    /** The last failed update's explanation, once; null when there is none. */
    static String takeProblem(Context context) {
        android.content.SharedPreferences prefs =
                context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
        String problem = prefs.getString(PROBLEM, null);
        if (problem != null) prefs.edit().remove(PROBLEM).apply();
        return problem;
    }
}
