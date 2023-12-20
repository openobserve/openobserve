import http from "./http";

const config = {
    authority: "http://127.0.0.1:5556/dex/", // Dex issuer URL
    client_id: "example-app",               // Your client ID
    redirect_uri: "http://localhost:5080/config/callback", // Your callback URI
    response_type: "code",
    scope: "openid profile email groups offline_access", // Add other scopes as needed
    post_logout_redirect_uri: "http://localhost:8081/", // Redirect after logout
    filterProtocolClaims: true,
    metadata: {
        authorization_endpoint: "http://127.0.0.1:5556/dex/auth",
        token_endpoint: "http://127.0.0.1:5556/dex/token",
        revocation_endpoint: "http://127.0.0.1:5556/dex/auth/revoke",
    },
    automaticSilentRenew: true,
};

export async function getAuthorizationCode(): Promise<string> {
    try {
        const res = await http().get("/config/dex_login");
        return res.data; // Assuming res.data contains the URL
    } catch (error) {
        console.error("Error fetching authorization code:", error);
        return ''; // Return a default value in case of error
    }
}
