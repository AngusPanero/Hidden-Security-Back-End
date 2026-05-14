require("dotenv").config();
const auth = require("./config/firebase");
 
const makeEnterprise = async (uid, companyName, companyLogo) => {
  try {
    const user = await auth.getUser(uid);
    const existingClaims = user.customClaims || {};
 
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      isEnterprise: true,
      companyName:  companyName  || null,
      companyLogo:  companyLogo  || null,
    });
  } catch (error) {
    console.error("Error seteando claim enterprise! 🔴", error);
  }
};
 
makeEnterprise(process.env.ENTERPRISE_USER, process.env.ENTERPRISE_COMPANY_NAME, process.env.ENTERPRISE_COMPANY_LOGO);