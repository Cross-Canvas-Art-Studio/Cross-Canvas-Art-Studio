## 2025-08-10 - Missing global requirement checks on resource endpoints
Vulnerability: An authorization bypass vulnerability existed in the `/api/projects/<project_id>` GET, PUT, and DELETE routes when `REQUIRE_AUTH` was enabled. Unauthenticated API clients could read, modify, or delete any unowned/public projects, bypassing the login wall.
Learning: Applying `REQUIRE_AUTH` on the listing or creation endpoints alone leaves individual resource retrieval, update, and deletion endpoints unprotected if they only check owner access and unowned projects are considered public.
Prevention: Ensure that all sensitive resource endpoints explicitly verify the global authentication requirement first before evaluating individual resource access permissions.
