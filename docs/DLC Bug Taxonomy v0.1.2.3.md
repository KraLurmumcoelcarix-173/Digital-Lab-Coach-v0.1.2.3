# DLC Bug Taxonomy v0.1.2.3 (Last update: 9/26/2026)

## Overview

| Column | Meaning |
| --- | --- |
| ID | S = structural, L = logic, P = process and submission |
| Caught by | An exact checker, gate or fix operation; deterministic means no model call is involved |
| Evidence | Spring 2026 labs or sample circuits in the repo|
| Weight | **3** seen in two or more real student labs, **2** seen in one real lab, **1** repo sample unit test only, **0** by design, the fix vocabulary exists but no sample yet |

Related code: dlc/facts/extractor.py, dlc/l3/debugger.py, dlc/l3/orcale.py, dlc/parser/...

## Structural bugs, Layer 1 (S)

All deterministic: the parser and the checkers find them without any model call, and each shows as an error or warning card on the Dashboard.

| ID | Bug | Caught by | Evidence | Weight |
| --- | --- | --- | --- | --- |
| S01 | Dangling input pin | wire completeness, `dangling_input` and `dangling_subcircuit_input` | tier1\_bug/dangling\_input.dig; tier2\_bug/dangling\_subcircuit\_input.dig; 2026 Lab 5 | 3 |
| S02 | Unused output | `unused_top_output` warning plus the purple `pins the tests never touch` card when tests exist | tier1\_bug/unused\_top\_output.dig | 1 |
| S03 | Multi-driver flow| wire completeness, `multi_driver` | tier1\_bug/multi\_driver.dig| 2 |
| S04 | Bit-width mismatch or conflict | bit-width checker, `width_mismatch` and `width_conflict` | tier1\_bug/width\_mismatch.dig, width\_conflict.dig, shifter\_width\_mismatch.dig; 2026 Lab 2,3,4,5| 3 |
| S05 | Missing subcircuit file | `missing_subcircuit` with cascade folding into one card | tier2\_bug/missing\_top\_subcircuit.dig, missing\_nested\_subcircuit.dig; All possible labs | 3 |
| S06 | Isolated component or unconnected top-level I/O | `isolated_component` warning card| tier1\_bug/isolated\_component.dig; 2026 Lab 5| 2 |
| S07 | Register without a clock, orphan clock, floating enable | sequential checker, `register_no_clock`, `orphan_clock`, `floating_register_en`; Mode A adds the `missing_clocked_logic` lazy rule | 30\_bug\_benchmark/bug4\_missing\_pipeline | 1 |
| S08 | Tunnel name mismatch or empty tunnel | `empty_tunnel`, plus undriven-net errors on the orphaned side and rename guidance on the test-variable side | tier1\_bug/empty\_tunnel.dig; 2026 Lab 5 | 2 |
| S09 | Combinational loop | loop checker, `combinational_loop` | tier1\_bug/combinational\_loop.dig | 1 |
| S10 | Duplicate input or output label | interface conformance, `duplicate_input_label`, `duplicate_output_label` | unit tests only | 1 |
| S11 | Element DLC cannot model | `unsupported_element` card naming every such element at any depth; Mode A and B refuse the file | unit tests only | 1 |
| S12 | Switch level miswire in a transistor lab | Layer 1 per-row evaluation and signal flow on NFET, PFET, PullUp, PullDown; Mode A and B refuse by design | tier2.5\_transistor | 1 |

## Logic bugs, Layer 3 Mode A (L)

The fix vocabulary is `change_attribute`, `replace_element`, `swap_pins`, `rewire_pin`, `add_wire`, `delete_wire`, `add_component`, `delete_component`.

| ID | Bug | Caught by | Evidence | Weight |
| --- | --- | --- | --- | --- |
| L01 | ROM word wrong | `rom_mismatch` | 2026 Lab 5 & Control-Unit | 3 |
| L02 | ALU operation mismapped | Through validated formula models | Lab 3 ALU; Lab 5| 2 |
| L03 | Mux select miswired or wrong arm | active arm localiser plus `rewire_pin` and `swap_pins` | 30\_bug\_benchmark/bug1\_meaningless\_mux\_in3, bug6\_hidden\_mux\_case3, bug9\_swapped\_select\_gate, bug10\_writeback\_select\_swapped | 2 |
| L04 | Operands swapped | `swap_pins` with machine verification | no fixture | 0 |
| L05 | Immediate or sign-extension wrong | `change_attribute` on splitter ranges | no fixture | 0 |
| L06 | Register-file port miswired | `rewire_pin` guided by suspect wiring facts; RegisterFile parsed and simulated | rv32i\_cpu rs0/rs1 miswire and cpu\_three\_miswire | 2 |
| L07 | PC increment wrong, PC divergence | cpu-tree gate routes to the failing child | Lab 5 | 2 |
| L08 | Missing pipeline or register stage | deterministic lazy suggestion `missing_clocked_logic` | 30\_bug\_benchmark/bug4\_missing\_pipeline, bug2\_wrong\_floating\_pipeline\_output | 1 |
| L09 | Control-unit or decoder gate wrong | machine tracing selector tables (`address_by_row`, `address_input_drivers`), top 12 suspect ranking + verified `replace_element` | 3-gate and 4-gate destroy tests on alu.dig and control-unit.dig fixed within one minute; bug5\_wrong\_boolean\_gate\_decoder\_logic LED1 to LED5; bug11; bug12\_encoder\_line; Lab 3, Lab 5 | 3 |
| L10 | Broken child subcircuit | `subcircuit_failing` suggestion: debug bottom-up| 30\_bug\_benchmark/bug7\_broken\_child; All possible labs | 2 |
| L11 | Several independent bugs in one circuit | iterative repair since v0.1.2: a verified fix is applied to the temp copy, the remaining rows are re-clustered, later calls carry a FIXED SO FAR block | All possible labs| 1 |

## Process and submission bugs (P)

Mistakes in how a lab is set up or submitted rather than in the logic.

| ID | Bug | Caught by | Evidence | Weight |
| --- | --- | --- | --- | --- |
| P01 | Instruction ROM not loaded or holding wrong words | `empty_rom` error card with the official-ROM note; since v0.1.2 no hidden injection: Mode A refuses on a ROM mismatch and gives hints only, and every verified fix carries a "check your ROM data" hint |Spring 2026 Lab 5 | 3 |
| P02 | Test data not pasted or modified | official testcase injected at upload, visible and labelled; the `official_test_mismatch` error card since v0.1.2.1; Mode B injects on its temp copy | every injected student run | 3 |
| P03 | Wrong file names | manifest name matching and rename guidance | Every possible labs | 3 |
| P04 | Starter-only or empty submission | Detected as lazy or stopped by layer 1| Every possible labs | 3 |