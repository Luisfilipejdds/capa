import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
    res.send("AdaptiveCapes Relay Online");
});

app.listen(8080, () => {
    console.log("Relay rodando na porta 8080");
});
