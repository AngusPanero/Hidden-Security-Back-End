const auth = require("../config/firebase");
const esProduccion = (process.env.NODE_ENV === 'production');

const enterpriseMiddleware = async (req, res, next) => {
    const token = req.cookies.idToken; 

    if (!token) {
        return res.status(401).json({ message: "No enterprisecredentials! 🔴" });
    }
    try {
        const decodedClaims = await auth.verifyIdToken(token);
        
        if (decodedClaims.isEnterprise === true) {
            req.user = decodedClaims;
            next();
        } else {
            return res.status(403).json({ message: "ACCESS_DENIED: ENTERPRISE_ONLY 🔴" });
        }
    } catch (error) {
        console.error(esProduccion ? `Unauthorized! 🔴` : `Unauthorized! 🔴 ${error}`);
        return res.status(401).json({ message: "Unauthorized" });
    }
};

module.exports = enterpriseMiddleware;