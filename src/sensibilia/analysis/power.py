"""Power and number of assessors for triangle, duo-trio and 2-AFC tests (exact binomial).

Pure Python so the calculator works without the R add-on; it needs no collected data. Follows
the guessing model and Thurstonian psychometric functions used by sensR (Christensen & Brockhoff):
pc = pg + pd (1 - pg); d' maps to pc through the method's psychometric function.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Method = Literal["triangle", "duo_trio", "two_afc"]
GUESSING = {"triangle": 1 / 3, "duo_trio": 1 / 2, "two_afc": 1 / 2}
MAX_ASSESSORS = 2000


def phi(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def pc_from_d_prime(method: Method, d: float) -> float:
    if method == "two_afc":
        return phi(d / math.sqrt(2))
    if method == "duo_trio":
        a, b = phi(d / math.sqrt(2)), phi(d / math.sqrt(6))
        return 1 - a - b + 2 * a * b
    # Triangle: 2 * integral over z >= 0 of
    #   [Phi(-z sqrt3 + d sqrt(2/3)) + Phi(-z sqrt3 - d sqrt(2/3))] phi(z) dz (Simpson's rule)
    steps, upper = 4000, 10.0
    h = upper / steps
    shift, scale = d * math.sqrt(2 / 3), math.sqrt(3)
    total = 0.0
    for i in range(steps + 1):
        z = i * h
        f = (phi(-z * scale + shift) + phi(-z * scale - shift)) * math.exp(-z * z / 2)
        total += f * (1 if i in (0, steps) else 4 if i % 2 else 2)
    return 2 * total * h / 3 / math.sqrt(2 * math.pi)


def d_prime_from_pc(method: Method, pc: float) -> float:
    if pc <= GUESSING[method]:
        return 0.0
    low, high = 0.0, 15.0
    for _ in range(80):
        middle = (low + high) / 2
        if pc_from_d_prime(method, middle) < pc:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def pc_from_pd(method: Method, pd: float) -> float:
    g = GUESSING[method]
    return g + pd * (1 - g)


def pmf(n: int, p: float) -> list[float]:
    """Binomial probabilities in log space, so large panels do not overflow."""
    if p <= 0 or p >= 1:
        return [1.0 if (i == 0 if p <= 0 else i == n) else 0.0 for i in range(n + 1)]
    lp, lq, ln = math.log(p), math.log1p(-p), math.lgamma(n + 1)
    return [
        math.exp(ln - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq)
        for i in range(n + 1)
    ]


def upper_tails(n: int, p: float) -> list[float]:
    """tails[k] = P(X >= k), k = 0..n+1."""
    tails = [0.0] * (n + 2)
    for i, value in zip(range(n, -1, -1), reversed(pmf(n, p)), strict=True):
        tails[i] = tails[i + 1] + value
    return tails


def difference_power(method: Method, n: int, alpha: float, pc: float) -> tuple[float, int]:
    null = upper_tails(n, GUESSING[method])
    critical = next(k for k in range(n + 2) if null[k] <= alpha)
    return upper_tails(n, pc)[critical], critical


def similarity_power(
    method: Method, n: int, alpha: float, pc_limit: float, pc_true: float
) -> tuple[float, int]:
    """H0: pc >= pc_limit; similar when correct answers <= critical. Power at pc_true."""
    null = upper_tails(n, pc_limit)  # P(X <= k) = 1 - P(X >= k + 1)
    candidates = [k for k in range(n + 1) if 1 - null[k + 1] <= alpha]
    if not candidates:
        return 0.0, -1
    critical = max(candidates)
    return 1 - upper_tails(n, pc_true)[critical + 1], critical


class PowerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Method
    purpose: Literal["difference", "similarity"] = "difference"
    alpha: Literal[0.01, 0.05, 0.1] = 0.05
    # Difference: the effect worth detecting. Similarity: the largest effect still called similar.
    effect: Literal["pd", "d_prime"] = "pd"
    size: float = Field(gt=0, le=6)
    target_power: float = Field(default=0.8, ge=0.5, le=0.99)
    assessors: int | None = Field(default=None, ge=5, le=MAX_ASSESSORS)

    @model_validator(mode="after")
    def bounds(self):
        if self.effect == "pd" and self.size >= 1:
            raise ValueError("The proportion of discriminators must be below 1")
        return self


class PowerRead(BaseModel):
    method: Method
    purpose: str
    alpha: float
    pd: float
    d_prime: float
    pc: float
    target_power: float
    assessors: int | None
    critical_correct: int | None
    power: float | None
    reachable: bool


def calculate(request: PowerRequest) -> PowerRead:
    method = request.method
    if request.effect == "pd":
        pd = request.size
        pc = pc_from_pd(method, pd)
        d = d_prime_from_pc(method, pc)
    else:
        d = request.size
        pc = pc_from_d_prime(method, d)
        pd = (pc - GUESSING[method]) / (1 - GUESSING[method])

    def power_at(n: int) -> tuple[float, int]:
        if request.purpose == "difference":
            return difference_power(method, n, request.alpha, pc)
        return similarity_power(method, n, request.alpha, pc, GUESSING[method])

    if request.assessors:
        power, critical = power_at(request.assessors)
        return PowerRead(
            method=method, purpose=request.purpose, alpha=request.alpha, pd=pd, d_prime=d, pc=pc,
            target_power=request.target_power, assessors=request.assessors,
            critical_correct=critical if critical >= 0 else None, power=power,
            reachable=power >= request.target_power,
        )  # fmt: skip
    for n in range(5, MAX_ASSESSORS + 1):
        power, critical = power_at(n)
        if power >= request.target_power:
            return PowerRead(
                method=method, purpose=request.purpose, alpha=request.alpha, pd=pd, d_prime=d,
                pc=pc, target_power=request.target_power, assessors=n,
                critical_correct=critical, power=power, reachable=True,
            )  # fmt: skip
    return PowerRead(
        method=method, purpose=request.purpose, alpha=request.alpha, pd=pd, d_prime=d, pc=pc,
        target_power=request.target_power, assessors=None, critical_correct=None, power=None,
        reachable=False,
    )  # fmt: skip
