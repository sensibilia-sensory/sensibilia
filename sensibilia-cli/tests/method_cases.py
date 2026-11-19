"""Reviewed test inputs exercise existing contracts; no operational study content."""

METHODS = (
    "hedonic-9-v1",
    "cata-v1",
    "rata-v1",
    "jar-v1",
    "triangle-v1",
    "duo-trio-v1",
    "two-afc-v1",
    "flash-profile-v1",
    "napping-v1",
    "tcata-v1",
)


def guided_values(method, samples):
    values = {"instructions": "Follow the reviewed laboratory protocol."}
    if method == "hedonic-9-v1":
        values["questions"] = "Overall liking\nAroma liking"
    else:
        values["sample_ids"] = [sample["id"] for sample in samples]
    if method in {"cata-v1", "rata-v1", "jar-v1"}:
        values["questions"] = "Sweet\nSour"
    if method == "rata-v1":
        values.update(scale_labels=["Low", "Medium", "High"], rating_min=0, require_ratings=False)
    if method == "duo-trio-v1":
        values.update(reference_mode="constant", reference_sample_id=samples[0]["id"])
    if method == "two-afc-v1":
        values.update(question="Which sample is sweeter?", expected_sample_id=samples[0]["id"])
    if method == "flash-profile-v1":
        values.update(
            descriptor_instructions="Describe the differences.",
            ranking_instructions="Rank by increasing intensity.",
            allow_ties=False,
        )
    if method == "napping-v1":
        values["collect_descriptions"] = True
    if method == "tcata-v1":
        values.update(
            attributes="Sweet\nSour",
            start_instruction="Begin after the staff instruction.",
            duration_ms=30000,
            required_tolerance_ms=50,
        )
    return values
