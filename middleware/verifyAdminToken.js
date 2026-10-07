const jwt = require("jsonwebtoken");

/**
 * Express middleware that extracts and verifies a Bearer JWT.
 * Attaches the decoded payload to req.user on success.
 *
 * Responses:
 *   401 { error: 'Token topilmadi' }                       - missing / non-Bearer header
 *   401 { error: 'Token yaroqsiz yoki muddati tugagan' }   - invalid / expired JWT
 *   403 { error: "Ruxsat yo'q" }                           - valid JWT but role !== 'admin'
 */
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "Token topilmadi" });
  }

  const token = match[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token yaroqsiz yoki muddati tugagan" });
  }

  if (!decoded || decoded.role !== "admin") {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  req.user = decoded;
  next();
}

module.exports = verifyAdminToken;
