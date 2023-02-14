//TODO: add this to bitbadges-js
export const NUM_PERMISSIONS = 5;

export type Permissions = {
    CanUpdateBytes: boolean
    CanManagerBeTransferred: boolean
    CanUpdateUris: boolean
    CanCreateMoreBadges: boolean
    CanUpdateDisallowed: boolean
}

export const CanUpdateBytesDigit = 5
export const CanManagerBeTransferredDigit = 4
export const CanUpdateUrisDigit = 3
export const CanCreateMoreBadgesDigit = 2
export const CanUpdateDisallowedDigit = 1

export function GetPermissionNumberValue(permissions: Permissions) {
    let permissionNumber = 0;
    for (let i = 0; i <= NUM_PERMISSIONS; i++) {
        let permissionDigit = i + 1;
        let permissionValue = false;
        switch (permissionDigit) {
            case CanUpdateBytesDigit:
                permissionValue = permissions.CanUpdateBytes;
                break;
            case CanManagerBeTransferredDigit:
                permissionValue = permissions.CanManagerBeTransferred;
                break;
            case CanUpdateUrisDigit:
                permissionValue = permissions.CanUpdateUris;
                break;
            case CanCreateMoreBadgesDigit:
                permissionValue = permissions.CanCreateMoreBadges;
                break;
            case CanUpdateDisallowedDigit:
                permissionValue = permissions.CanUpdateDisallowed;
                break;
            default:
                break;
        }
        if (permissionValue) {
            permissionNumber += 2 ** (permissionDigit - 1);
        }
    }
    return permissionNumber;
}

export function ValidatePermissions(permissions: number) {
    let tempPermissions = permissions >> NUM_PERMISSIONS;
    if (tempPermissions != 0) {
        throw 'Invalid permissions: Leading Zeroes';
    }
}

export function ValidatePermissionsUpdate(oldPermissions: number, newPermissions: number) {
    try {
        ValidatePermissions(oldPermissions);
        ValidatePermissions(newPermissions);
    } catch (error) {
        throw error;
    }

    let oldFlags = GetPermissions(oldPermissions);
    let newFlags = GetPermissions(newPermissions);

    if (!oldFlags.CanUpdateBytes && newFlags.CanUpdateBytes) {
        throw 'Invalid permissions: Updating CanUpdateBytes is locked';
    }

    if (!oldFlags.CanUpdateUris && newFlags.CanUpdateUris) {
        throw 'Invalid permissions: Updating CanUpdateUris is locked';
    }

    if (!oldFlags.CanUpdateDisallowed && newFlags.CanUpdateDisallowed) {
        throw 'Invalid permissions: Updating CanUpdateDisallowed is locked';
    }

    if (!oldFlags.CanCreateMoreBadges && newFlags.CanCreateMoreBadges) {
        throw 'Invalid permissions: Updating CanCreateMoreBadges is locked';
    }

    if (!oldFlags.CanManagerBeTransferred && newFlags.CanManagerBeTransferred) {
        throw 'Invalid permissions: Updating CanManagerBeTransferred is locked';
    }
}

//IMPORTANT: No validity checks done
export function UpdatePermissions(currPermissions: number, permissionDigit: number, value: boolean) {
    if (permissionDigit > NUM_PERMISSIONS || permissionDigit <= 0) {
        throw 'Invalid permission digit';
    }

    let mask = 1 << (permissionDigit - 1);
    let masked_n = currPermissions & mask;
    let bit = masked_n >> (permissionDigit - 1);
    let bit_as_bool = bit == 1;

    if (value != bit_as_bool) {
        if (bit_as_bool) {
            currPermissions -= 2 ** (permissionDigit - 1);
        } else {
            currPermissions += 2 ** (permissionDigit - 1);
        }
    }

    return currPermissions;
}

export function GetPermissions(permissions: number) {
    let permissionFlags: any = {};
    for (let i = 0; i <= NUM_PERMISSIONS; i++) {
        let mask = 1 << i;
        let masked_n = permissions & mask;
        let bit = masked_n >> i;
        let bit_as_bool = bit == 1;
        switch (i + 1) {
            case CanUpdateBytesDigit:
                permissionFlags.CanUpdateBytes = bit_as_bool;
                break;
            case CanManagerBeTransferredDigit:
                permissionFlags.CanManagerBeTransferred = bit_as_bool;
                break;
            case CanUpdateUrisDigit:
                permissionFlags.CanUpdateUris = bit_as_bool;
                break;
            case CanCreateMoreBadgesDigit:
                permissionFlags.CanCreateMoreBadges = bit_as_bool;
                break;
            case CanUpdateDisallowedDigit:
                permissionFlags.CanUpdateDisallowed = bit_as_bool;
                break;
            default:
                break;
        }
    }
    return permissionFlags as Permissions
}