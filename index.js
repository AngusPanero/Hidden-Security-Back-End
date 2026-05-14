require("dotenv").config()
const express = require("express")
const cors = require("cors")
const { urlencoded } = require("body-parser")
const cookieParser = require("cookie-parser")
const dbConnection = require("./config/mongoose")
const authRouter = require("./routes/authRouter")
const mailRouter = require("./nodemailer/nodemailer")
const mercadoPagoRouter = require("./routes/mercadoPagoRouter")
const raffleRouter = require("./routes/raffleRouter")
const paymentsRouter = require("./routes/paymentRoutes")
const firebaseRouter = require("./routes/firebaseRouter")
const cartRouter = require("./routes/cartRouter")
const vacancyRouter = require("./routes/vacancyRouter")
const adminMiddleware = require("./middleware/adminMiddleware")
const { sseHandler } = require("./sseManager/sseManajer")
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

app.use(authRouter)
app.use(mailRouter)
app.use(mercadoPagoRouter)
app.use(raffleRouter)
app.use(paymentsRouter)
app.use(firebaseRouter)
app.use(cartRouter)
app.use(vacancyRouter)

app.use((req, res) => {
    res.send(`<h1>404 - Not Found</h1>`)
})

app.listen(PORT, "0.0.0.0", (req, res) => {
    console.log(`Server listening🟢`)
})