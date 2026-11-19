package app.sensibilia.assessor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServersTest {
    @Test
    public void pairingUrlGivesOriginFingerprintAndCode() {
        Servers.Target t = Servers.parse(
                "https://192.168.0.128:1379/assessor/pair?ca=c68123cb85#K7Q42MXY");
        assertEquals("https://192.168.0.128:1379", t.origin);
        assertEquals("C68123CB85", t.caFingerprint);
        assertEquals("K7Q42MXY", t.pairingCode);
    }

    @Test
    public void typedHostAndPortGetHttps() {
        Servers.Target t = Servers.parse("  10.0.0.5:1379 ");
        assertEquals("https://10.0.0.5:1379", t.origin);
        assertNull(t.caFingerprint);
        assertNull(t.pairingCode);
    }

    @Test
    public void plainHttpIsUpgradedAndPathsAreDropped() {
        assertEquals("https://lab.example.edu",
                Servers.parse("http://lab.example.edu/assessor/").origin);
    }

    @Test
    public void colonSeparatedFingerprintsAreNormalised() {
        assertEquals("AABB", Servers.parse("host:1?ca=aa:bb").caFingerprint);
    }

    @Test
    public void nonsenseIsRejected() {
        assertNull(Servers.parse(""));
        assertNull(Servers.parse("   "));
        assertNull(Servers.parse(null));
        assertNull(Servers.parse("https://"));
    }

    @Test
    public void groupedFingerprintHasColonsBetweenBytes() {
        assertEquals("AA:BB:CC", Servers.grouped("AABBCC"));
    }

    @Test
    public void caMismatchComparesNormalisedFingerprints() {
        assertFalse(Servers.caMismatch("AABB", "AABB"));
        assertFalse(Servers.caMismatch("AABB", "aa:bb"));
        assertFalse(Servers.caMismatch("aa:bb", " AABB "));
        assertTrue(Servers.caMismatch("AABB", "AACC"));
    }

    @Test
    public void caMismatchNeedsBothSides() {
        assertFalse(Servers.caMismatch(null, "AABB"));
        assertFalse(Servers.caMismatch("AABB", null));
        assertFalse(Servers.caMismatch(null, null));
    }

    @Test
    public void groupedFingerprintHasColonSeparatedPairs() {
        assertEquals("AA:BB:CC", Servers.grouped("AABBCC"));
    }
}
