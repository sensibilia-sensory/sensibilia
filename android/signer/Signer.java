import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.List;

/** Signs an APK with a PKCS12 key (v2 and v3 schemes). Used by the portable
 *  install: java -jar signer.jar in.apk out.apk keystore.p12 passwordfile alias */
public class Signer {
    public static void main(String[] args) throws Exception {
        String password = new String(Files.readAllBytes(new File(args[3]).toPath()), StandardCharsets.US_ASCII).trim();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(args[2])) {
            store.load(in, password.toCharArray());
        }
        PrivateKey key = (PrivateKey) store.getKey(args[4], password.toCharArray());
        X509Certificate certificate = (X509Certificate) store.getCertificate(args[4]);
        ApkSigner.SignerConfig config = new ApkSigner.SignerConfig.Builder(
            "sensibilia", key, List.of(certificate)).build();
        new ApkSigner.Builder(List.of(config))
            .setInputApk(new File(args[0]))
            .setOutputApk(new File(args[1]))
            .setMinSdkVersion(29)
            .setV1SigningEnabled(false)
            .setV2SigningEnabled(true)
            .setV3SigningEnabled(true)
            .build()
            .sign();
    }
}
