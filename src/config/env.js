import dotenv from 'dotenv';
dotenv.config();

export const env = {
    port: process.env.PORT,
    jwtSecret: process.env.JWT_SECRET
};
