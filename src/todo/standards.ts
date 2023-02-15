import { BitBadgeStandard } from './bitbadge';

export interface MetadataStandard {
    name: string;
    validate: (data: any) => any; //returns validated data, throws Error if invalid
}

/**
 * Searches for standard in STANDARDS by name. If not found, throws an error.
 */
export function getStandard(name: string) {
    const standard = STANDARDS.find(elem => elem.name === name);
    if (!standard) throw `${name} is not a valid standard. See metadata-standards/standards.ts for more details.`;
    return standard;
}

/**
 * This STANDARDS array defines the supported metadata types for BitBadges.
 */
const STANDARDS: MetadataStandard[] = [
    BitBadgeStandard
];
