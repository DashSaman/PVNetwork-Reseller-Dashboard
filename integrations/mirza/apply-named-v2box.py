"""Patch a staged Mirza tree with the two V2Box delivery hooks."""

from pathlib import Path
import shutil
import sys


DELIVERY = """    if (!check_active_btn($setting['keyboardmain'], "text_help"))
        $reply_markup = null;
    $user_id = $user_id == null ? $from_id : $user_id;
"""
NAMED_DELIVERY = DELIVERY.replace(
    "    $user_id =",
    "    $reply_markup = pvnetwork_named_v2box_keyboard($panel_info, $sub_link, $reply_markup);\n    $user_id =",
)
GET_SUB = """        update("user", "Processing_value", $nameloc['username'], "id", $from_id);
        $subscriptionurl = $DataUserOut['subscription_url'];
        $randomString = bin2hex(random_bytes(3));
"""
NAMED_GET_SUB = GET_SUB.replace(
    "        $randomString =",
    "        $bakinfos = pvnetwork_named_v2box_keyboard($marzban_list_get, $subscriptionurl, $bakinfos);\n        $randomString =",
)


def inject(source, original, changed):
    if source.count(changed) == 1:
        return source
    if source.count(original) != 1:
        raise ValueError("Expected a unique Mirza delivery hook")
    return source.replace(original, changed, 1)


def apply(staging):
    functions = staging / "function.php"
    index = staging / "index.php"
    api = staging / "panels" / "Api"
    if not (api / "pvnetwork-selection.php").is_file():
        raise ValueError("Expected the existing PVNetwork Mirza connector")

    function_source = functions.read_text(encoding="utf-8")
    entry = "function sendMessageService("
    include = "require_once __DIR__ . '/panels/Api/pvnetwork-v2box.php';\n"
    function_source = inject(function_source, entry, include + entry)
    function_source = inject(function_source, DELIVERY, NAMED_DELIVERY)
    index_source = inject(index.read_text(encoding="utf-8"), GET_SUB, NAMED_GET_SUB)

    shutil.copyfile(Path(__file__).with_name("pvnetwork-v2box.php"), api / "pvnetwork-v2box.php")
    functions.write_text(function_source, encoding="utf-8", newline="\n")
    index.write_text(index_source, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    apply(Path(sys.argv[1]))
