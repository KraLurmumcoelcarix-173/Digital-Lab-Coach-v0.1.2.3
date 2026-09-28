"""extract_json_object: one JSON object out of a model reply, whatever
surrounds it and however the tail was cut."""

import json

from dlc.llm.jsonish import close_open_structures, extract_json_object

DOC = {"contract": "l3.debug.v1.1", "confidence": 0.9,
       "hint": {"suspect_region": "the adder", "suspect_signals": ["c_i"]},
       "fix": {"ops": [{"op": "change_attribute", "component_index": 16,
                        "name": "Value", "value": 0}],
               "animation_script": [{"act": "retest"}]}}
TEXT = json.dumps(DOC)


def test_clean_object():
    assert extract_json_object(TEXT) == (DOC, None)


def test_one_closing_brace_short_is_the_live_case():
    assert TEXT.endswith("]}}")
    assert extract_json_object(TEXT[:-1]) == (DOC, None)


def test_several_closers_missing():
    assert extract_json_object(TEXT[:-3]) == (DOC, None)


def test_cut_inside_a_string_value_keeps_the_part_we_have():
    cut = TEXT[:TEXT.index("the adder") + 5]
    obj, why = extract_json_object(cut)
    assert why is None
    assert obj["hint"]["suspect_region"] == "the a"
    assert obj["contract"] == "l3.debug.v1.1"


def test_cut_inside_a_key_drops_that_key():
    cut = TEXT[:TEXT.index('"suspect_signals"') + 6]
    obj, why = extract_json_object(cut)
    assert why is None
    assert obj["hint"] == {"suspect_region": "the adder"}


def test_cut_right_after_a_key_colon_drops_that_key():
    cut = TEXT[:TEXT.index('"fix":') + 6]
    obj, why = extract_json_object(cut)
    assert why is None
    assert "fix" not in obj and obj["hint"]["suspect_region"] == "the adder"


def test_prose_and_fences_around_the_object():
    wrapped = "Here you go:\n```json\n" + TEXT + "\n```\nHope that {helps}."
    assert extract_json_object(wrapped) == (DOC, None)
    plain = "Sure. " + TEXT + " Let me know if the {carry} needs more."
    assert extract_json_object(plain) == (DOC, None)


def test_leading_brace_in_prose_does_not_hide_the_object():
    assert extract_json_object("the {carry} is wrong: " + TEXT) == (DOC, None)


def test_failures_say_why():
    assert extract_json_object("") == (None, "empty reply")
    assert extract_json_object("no json here") == (None, "no JSON object found")
    obj, why = extract_json_object("[1, 2, 3]")
    assert obj is None
    obj, why = extract_json_object('{"a": }')
    assert obj is None and "char" in why


def test_close_open_structures_refuses_a_stray_closer():
    assert close_open_structures('{"a": 1}}') is None
    assert close_open_structures('{"a": [1}') is None
    assert close_open_structures('{"a": [1, 2') == '{"a": [1, 2]}'
    assert close_open_structures('{"a": [1, 2,') == '{"a": [1, 2]}'
