package app.sensibilia.assessor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdaterTest {
    private static final String SHA = "AB".repeat(32);
    private static final String JSON = "{\"version_code\": 4, \"version_name\": \"0.1.3\", "
            + "\"sha256\": \"" + SHA + "\"}";

    @Test
    public void newerVersionIsOffered() {
        Updater.Offer offer = Updater.parse(JSON, 3);
        assertNotNull(offer);
        assertEquals(4, offer.code);
        assertEquals("0.1.3", offer.name);
        assertEquals("ab".repeat(32), offer.sha256);
    }

    @Test
    public void sameOrOlderVersionIsNotOffered() {
        assertNull(Updater.parse(JSON, 4));
        assertNull(Updater.parse(JSON, 5));
    }

    @Test
    public void incompleteOrMalformedInfoIsIgnored() {
        assertNull(Updater.parse(null, 1));
        assertNull(Updater.parse("Not found", 1));
        assertNull(Updater.parse("{\"version_code\": 4, \"version_name\": \"0.1.3\"}", 1));
        assertNull(Updater.parse(JSON.replace(SHA, "1234"), 1));
    }

    @Test
    public void signatureConflictSaysToUninstall() {
        String problem = Updater.problem(
                android.content.pm.PackageInstaller.STATUS_FAILURE_CONFLICT, null);
        assertTrue(problem.contains("uninstall"));
        assertNull(Updater.problem(android.content.pm.PackageInstaller.STATUS_SUCCESS, null));
    }

    @Test
    public void hexIsLowerCase() {
        assertEquals("00ff10", Updater.hex(new byte[] {0, (byte) 0xff, 0x10}));
    }
}
