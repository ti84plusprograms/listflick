# Firebase and Supabase boundaries

Firebase is the identity system. It signs users in and issues ID tokens. The
backend verifies those tokens and uses the verified UID for authorization.

Supabase is the backend storage provider. The bucket is private, and only the
backend uses the service-role credential. The mobile app receives a short-lived
signed URL or an authenticated backend image response.

This separation prevents a Firebase-authenticated client from directly
bypassing backend ownership checks or obtaining unrestricted Storage access.
