import type { UserProfile } from "../types/listing";

export type AuthProfileUser = {
  displayName?: string | null;
  email?: string | null;
};

export const EMPTY_PROFILE: UserProfile = {
  name: "",
  username: "",
  pickupLocation: "",
  paymentMethods: "",
};

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function userProfileDefaultsFromAuth(user: AuthProfileUser | null | undefined): Partial<UserProfile> {
  return {
    name: clean(user?.displayName),
    username: clean(user?.email),
  };
}

export function withUserProfileDefaults(
  profile: Partial<UserProfile> | null | undefined,
  defaults: Partial<UserProfile> = {}
): UserProfile {
  const saved = { ...EMPTY_PROFILE, ...(profile ?? {}) };
  const seeded = { ...EMPTY_PROFILE, ...defaults };

  return {
    name: clean(saved.name) || clean(seeded.name),
    username: clean(seeded.username) || clean(saved.username),
    pickupLocation: saved.pickupLocation,
    paymentMethods: saved.paymentMethods,
  };
}

export function isUserProfileComplete(profile: UserProfile): boolean {
  return Boolean(
    clean(profile.name) &&
      clean(profile.username) &&
      clean(profile.pickupLocation) &&
      clean(profile.paymentMethods)
  );
}
