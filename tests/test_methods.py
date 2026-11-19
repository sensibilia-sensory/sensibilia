import pytest
from pydantic import ValidationError

from sensibilia.methods import HedonicConfiguration, HedonicValue


def configuration(**overrides):
    return {
        "instructions": "Taste and rate the sample.",
        "questions": [{"id": "overall", "prompt": "How much do you like it?"}],
        **overrides,
    }


def test_configuration_defaults():
    parsed = HedonicConfiguration.model_validate(configuration())
    assert len(parsed.scale_labels) == 9
    assert not parsed.allow_skips


@pytest.mark.parametrize(
    "override",
    [
        {"questions": []},
        {"scale_labels": ["Low", "High"]},
        {"instructions": "  "},
        {"scale_labels": [" "] * 9},
        {"unknown": True},
        {"questions": [{"id": "overall", "prompt": "One"}, {"id": "overall", "prompt": "Two"}]},
    ],
)
def test_invalid_configuration(override):
    with pytest.raises(ValidationError):
        HedonicConfiguration.model_validate(configuration(**override))


@pytest.mark.parametrize("rating", [0, 10, True, 1.0, "5", None])
def test_invalid_rating(rating):
    with pytest.raises(ValidationError):
        HedonicValue(state="rated", rating=rating)


def test_distinct_value_states():
    assert HedonicValue(state="rated", rating=1).rating == 1
    assert HedonicValue(state="rated", rating=9).rating == 9
    assert HedonicValue(state="skipped").model_dump() == {"state": "skipped", "rating": None}
    # Missing is absence of an event. Zero/unselected belong to other methods, not hedonic.
    for value in (
        {"state": "unselected"},
        {"state": "missing"},
        {"state": "skipped", "rating": 0},
        {"state": "skipped", "rating": 5},
    ):
        with pytest.raises(ValidationError):
            HedonicValue.model_validate(value)


def labels(named, size=9):
    """A scale with only the steps in `named` (0-based) named."""
    return [f"Step {i + 1}" if i in named else "" for i in range(size)]


@pytest.mark.parametrize("named", [{0, 8}, {0, 4, 8}, {0, 1, 2, 3, 4, 5, 6, 7, 8}])
def test_hedonic_steps_between_the_ends_may_be_unnamed(named):
    parsed = HedonicConfiguration.model_validate(configuration(scale_labels=labels(named)))
    assert [bool(label) for label in parsed.scale_labels] == [i in named for i in range(9)]


@pytest.mark.parametrize("named", [set(), {0}, {8}, {4}, {1, 7}])
def test_hedonic_ends_must_be_named(named):
    with pytest.raises(ValidationError, match="first and last"):
        HedonicConfiguration.model_validate(configuration(scale_labels=labels(named)))


def test_scale_label_length_is_still_limited():
    with pytest.raises(ValidationError):
        HedonicConfiguration.model_validate(
            configuration(scale_labels=["Low", *[""] * 7, "x" * 201])
        )


def test_rata_and_jar_allow_unnamed_steps_with_the_same_rules():
    from sensibilia.methods import JARConfiguration, RATAConfiguration

    base = {"instructions": "Rate.", "questions": [{"id": "sweet", "prompt": "Sweet"}]}
    rata = base | {"kind": "rata"}
    parsed = RATAConfiguration.model_validate(rata | {"scale_labels": ["Low", "", "", "", "High"]})
    assert parsed.scale_labels[1:4] == ["", "", ""]
    with pytest.raises(ValidationError, match="first and last"):
        RATAConfiguration.model_validate(rata | {"scale_labels": ["", "Mid", "High"]})
    jar = base | {"kind": "jar"}
    parsed = JARConfiguration.model_validate(
        jar | {"scale_labels": ["Too little", "", "Just about right", "", "Too much"]}
    )
    assert parsed.scale_labels[2] == "Just about right"
    # The centre defines JAR, so it is named as well as the ends.
    with pytest.raises(ValidationError, match="centre"):
        JARConfiguration.model_validate(
            jar | {"scale_labels": ["Too little", "", "", "", "Too much"]}
        )
