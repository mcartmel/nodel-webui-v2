import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketPermission;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import org.nanohttpd.protocols.http.HTTPSession;
import org.nanohttpd.protocols.http.NanoHTTPD;
import org.nanohttpd.protocols.http.request.Request;
import org.nanohttpd.protocols.http.response.Response;
import org.nanohttpd.protocols.http.tempfiles.DefaultTempFileManager;
import org.nodel.SimpleName;
import org.nodel.core.NodeAddress;
import org.nodel.discovery.AdvertisementInfo;
import org.nodel.discovery.AutoDNS;
import org.nodel.host.BaseNode;
import org.nodel.json.JSONArray;
import org.nodel.json.JSONObject;
import org.nodel.jyhost.NodelHost;
import org.nodel.jyhost.NodelHostHTTPD;
import org.slf4j.LoggerFactory;
import sun.misc.Unsafe;

/** Harness only. No Nodel installation, node instances, or network sockets. */
public final class JavaDiscoveryContract {
    public static final class SyntheticAutoDNS extends AutoDNS {
        private static SyntheticAutoDNS provider;
        private final List<AdvertisementInfo> listing;
        private int reads;

        private SyntheticAutoDNS(List<AdvertisementInfo> listing) {
            this.listing = List.copyOf(listing);
        }

        public static SyntheticAutoDNS instance() { return provider; }
        @Override public List<AdvertisementInfo> list() { reads++; return listing; }
        @Override public NodeAddress resolveNodeAddress(SimpleName node) { throw new AssertionError("Unexpected resolution"); }
        @Override public AdvertisementInfo resolve(SimpleName node) { throw new AssertionError("Unexpected resolution"); }
        @Override public void registerService(SimpleName node) { throw new AssertionError("Unexpected registration"); }
        @Override public void unregisterService(SimpleName node) { throw new AssertionError("Unexpected registration"); }
        @Override public void close() { }
    }

    // Request's production constructor needs local/remote metadata even on a byte-stream session.
    private static final class MemoryPeer extends Socket {
        private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();
        @Override public InetAddress getInetAddress() { return LOOPBACK; }
        @Override public InetSocketAddress getRemoteSocketAddress() { return new InetSocketAddress(LOOPBACK, 12345); }
        @Override public InetSocketAddress getLocalSocketAddress() { return new InetSocketAddress(LOOPBACK, 8085); }
    }

    private static void setField(Object target, String name, Object value) throws ReflectiveOperationException {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static NanoHTTPD transport() throws ReflectiveOperationException, InstantiationException {
        // Skip both host constructors: they start topology/interface watchers and node maintenance.
        // The real model, annotated endpoints and their host delegates are not overridden.
        Field field = Unsafe.class.getDeclaredField("theUnsafe");
        field.setAccessible(true);
        Unsafe allocation = (Unsafe) field.get(null);
        NodelHostHTTPD endpoint = (NodelHostHTTPD) allocation.allocateInstance(NodelHostHTTPD.class);
        endpoint.setNodeHost((NodelHost) allocation.allocateInstance(NodelHost.class));
        setField(endpoint, "_logger", LoggerFactory.getLogger(NodelHostHTTPD.class));
        setField(endpoint, "_restModel", endpoint.new RESTModel());

        // Real NanoHTTPD parser/request bridge; replace only the socket transport/host lifecycle.
        return new NanoHTTPD(0, null, false) {
            @Override public Response serve(String uri, File root, String method, Properties params, Request request) {
                return endpoint.serve(uri, root, method, params, request);
            }
        };
    }

    @SuppressWarnings("removal") // Fixture runs with JDK 21; deny Java network permissions before loading Nodel.
    public static void main(String[] args) throws Exception {
        System.setSecurityManager(new SecurityManager() {
            @Override public void checkPermission(Permission permission) {
                if (permission instanceof SocketPermission || "getNetworkInformation".equals(permission.getName())) {
                    throw new SecurityException("No network in discovery fixture: " + permission);
                }
            }
        });

        Path work = Path.of(args[0]);
        JSONArray ads = new JSONArray(Files.readString(work.resolve("advertisements.json")));
        List<AdvertisementInfo> listing = new ArrayList<>();
        for (int i = 0; i < ads.length(); i++) {
            JSONObject ad = ads.getJSONObject(i);
            JSONArray addresses = ad.getJSONArray("addresses");
            List<String> values = new ArrayList<>();
            for (int j = 0; j < addresses.length(); j++) values.add(addresses.getString(j));
            listing.add(new AdvertisementInfo(new SimpleName(ad.getString("name")), values, ad.getLong("timeStamp")));
        }
        SyntheticAutoDNS provider = new SyntheticAutoDNS(listing);
        SyntheticAutoDNS.provider = provider;
        System.setProperty(AutoDNS.IMPL_SYSTEMPROP, SyntheticAutoDNS.class.getName());
        if (AutoDNS.instance() != provider || !BaseNode.getNodes().isEmpty()) {
            throw new AssertionError("Expected the synthetic provider and no local nodes/bindings");
        }

        NanoHTTPD transport = transport();
        for (int i = 1; i < args.length; i++) {
            Path request = work.resolve(args[i] + ".request");
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            try (Socket peer = new MemoryPeer()) {
                new HTTPSession(transport, new DefaultTempFileManager(work.toFile()),
                        new ByteArrayInputStream(Files.readAllBytes(request)), response, peer).execute();
            }
            if (provider.reads != i) throw new AssertionError("Expected one complete AutoDNS.list call per request");
            Files.write(work.resolve(args[i] + ".response"), response.toByteArray());
        }
    }
}
