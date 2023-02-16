
/**
 * These are all helper functions for CouchDB. Mainly to keep it uniform if I need to change anything drastic.
*/

/**
 * Checks if doc exists, throws error if doesn't.
 */
export async function doesDocExist(db: any, docId: string) {
    await db.head(docId);
    return true;
}

// /**
//  * Returns doc if doc exists, throws error if doesn't.
//  */
// export async function getDoc(db: any, docId: string) {
//     const docData = await db.get(docId);
//     return docData;
// }

// /**
//  * Returns doc if doc exists, throws error if doesn't.
//  */
// export async function getDocAndAddTemplateIfEmpty(db: any, docId: string) {
//     let data;
//     try {
//         data = await db.get(docId);
//     } catch (error) {
//         const err = error as any;
//         if (err.statusCode == 404 && db.config.db == 'private-users') {
//             const inputData = JSON.parse(JSON.stringify(blankTemplates['private-users']));
//             data = await db.insert(inputData, docId);
//             data = await db.get(docId);
//         } else {
//             throw `Error in getDocAndAddIfEmpty(): Couldn't get doc or insert blank template: ${error}`;
//         }
//     }

//     return data;
// }

/**
 * Returns doc if doc exists, throws error if doesn't.
 */
export async function getDocAndReturnTemplateIfEmpty(db: any, docId: string) {
    let data: any = {};
    try {
        data = await db.get(docId);
    } catch (error) {
        const err = error as any;
        if (err.statusCode == 404) {
            data = {};
            data._id = docId;
        } else {
            throw `Error in getDocAndaReturnTemplateIfEmpty(): Couldn't get doc or insert blank template: ${error}`;
        }
    }

    return data;
}


/**
 * Returns doc if doc exists, throws error if doesn't.
 */
export async function getDoc(db: any, docId: string) {
    let data: any = {};
    try {
        data = await db.get(docId);
    } catch (error) {
        throw `Error in getDic(): Couldn't get doc or insert blank template: ${error}`;
    }

    return data;
}

/**
 * Fetches doc and places empty template in if doesn't exist
 */
export async function assertDocExists(db: any, docId: string) {
    try {
        await db.head(docId);
    } catch (error) {
        throw `Error in assertDocExists(): ${error}`;
    }
}

/**
 * Asserts doc does not exist. Throws error if 404 is NOT returned.
 */
export async function assertDocDoesNotExist(db: any, docId: string) {
    try {
        await db.head(docId);
    } catch (error) {
        const err = error as any;
        if (err.statusCode == 404) {
            return;
        }

        throw `Error in assertDocDoesNotExist(): Expected 404 but got ${err.statusCode}: ${err}`;
    }

    throw 'Error in assertDocDoesNotExist(): Expected 404 but got 200';
}
