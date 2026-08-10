# Sentinel's Security Journal

## 2026-08-10 - WebAuthn Unauthorized Passkey Registration (Account Takeover)
**Vulnerability:** A critical authentication bypass / account takeover vulnerability existed in the passkey registration flow. If a user requested passkey options with an existing username (e.g., `admin`), the backend returned `is_new_user = False` along with the existing user's ID. During verification, the backend linked the new passkey to that ID without checking if the requester was authenticated as that user, enabling immediate account takeover.
**Learning:** Never assume that multi-step WebAuthn flows (such as registering a new credential) are implicitly authorized. Modifying or adding credentials to an existing user account must always be gated behind active session verification.
**Prevention:** If a user already exists during credential registration initialization, reject the request unless the current session is explicitly authenticated as that same user.
