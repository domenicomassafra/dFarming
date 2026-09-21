export default {
    dialect: 'postgresql',
    schema: './src/database/schema.ts',
    out: './drizzle',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgresql://phone_farm:CHANGE_ME@127.0.0.1:5432/phone_farm',
    },
    strict: true,
    verbose: true,
};
