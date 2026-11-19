package app.sensibilia.assessor;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/**
 * Device-owner component. Provisioning (factory-reset tablet, no accounts):
 * adb shell dpm set-device-owner app.sensibilia.assessor/.KioskAdmin
 */
public class KioskAdmin extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        allowLockTask(context);
    }

    /** Lets this app enter lock task (kiosk) mode without a user prompt. */
    static void allowLockTask(Context context) {
        DevicePolicyManager dpm =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (!dpm.isDeviceOwnerApp(context.getPackageName())) return;
        ComponentName admin = new ComponentName(context, KioskAdmin.class);
        dpm.setLockTaskPackages(admin, new String[] {context.getPackageName()});
        // No home, recents, notifications or system info while locked.
        dpm.setLockTaskFeatures(admin, 0);
    }
}
