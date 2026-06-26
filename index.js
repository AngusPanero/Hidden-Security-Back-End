require("dotenv").config()
const express = require("express")
const cors = require("cors")
const { urlencoded } = require("body-parser")
const cookieParser = require("cookie-parser")
const dbConnection = require("./config/mongoose")
const authRouter = require("./routes/authRouter")
const mailRouter = require("./nodemailer/nodemailer")
const mercadoPagoRouter = require("./routes/mercadoPagoRouter")
const paymentsRouter = require("./routes/paymentRoutes")
const firebaseRouter = require("./routes/firebaseRouter")
const cartRouter = require("./routes/cartRouter")
const vacancyRouter = require("./routes/vacancyRouter")
const cvRouter = require("./routes/cvRouter")
const usersDbRouter = require("./routes/usersDataBase")
const adminMiddleware = require("./middleware/adminMiddleware")
const enterpriseMiddleware = require("./middleware/enterpriseMiddleware")
const certifiedMiddleware = require("./middleware/certificatedMiddleware")
const { sseHandler } = require("./sseManager/sseManajer")
const { applicantSseHandler } = require("./sseManager/sseApplicants")
const { userSseHandler } = require("./sseManager/sseUserNotifications");
const courseRouter = require("./routes/courseRouter")
const app = express()
const PORT = process.env.PORT

app.set('trust proxy', 1); // Para el Rate Limiter
app.use(urlencoded({ extended: true }))
app.use(express.json())
app.use(cookieParser())

dbConnection()

app.use(cors({
    origin: [ `${process.env.LOCAL_LINK}`, `${process.env.LOCAL_HOST_MOBILE}`, `${process.env.API_BACKEND_URL}`, `${process.env.FRONT_END}`, `${process.env.FRONT_END_WWW}`, `${process.env.LOCAL_HOST}`].filter(Boolean),
    methods: [ "GET", "POST", "PUT", "PATCH", "DELETE" ],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}))

app.get("/api/payments/stream", adminMiddleware, sseHandler);
app.get("/api/vacancy/applicants/stream", enterpriseMiddleware, applicantSseHandler);
app.get("/api/user/notifications/stream", certifiedMiddleware, userSseHandler);

app.use(cvRouter)
app.use(authRouter)
app.use(mailRouter)
app.use(mercadoPagoRouter)
app.use(paymentsRouter)
app.use(firebaseRouter)
app.use(cartRouter)
app.use(vacancyRouter)
app.use(courseRouter)
app.use(usersDbRouter)

app.use((req, res) => {
    res.send(`<h1>404 - Not Found</h1>`)
})

app.listen(PORT, "0.0.0.0", (req, res) => {
    console.log(`Server listening🟢`)
})