const repo = require('../repositories/codelists.repo');

exports.getCodelistByName = async (name) => {
    try {
        return await repo.getCodelistByName(name);
    } catch (error) {
        console.error("Error fetching codelist by name:", error);
        throw error; // Re-throw the error instead of trying to use undefined 'res'
    }
};