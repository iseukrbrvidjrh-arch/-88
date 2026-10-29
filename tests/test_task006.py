"""TASK-006 archive, controlled deletion and frozen context snapshots."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.errors import ApplicationError
from app.core.config import Settings
from app.main import create_app
from app.repositories.database import Database
from app.repositories.migrations.runner import initialize_database
from app.repositories.subtitle_lifecycle import SubtitleLifecycleRepository
from app.services.subtitle_import import import_subtitle
from app.services.subtitle_lifecycle import change_archive, delete_subtitle, deletion_preview
from app.services.subtitle_query import list_subtitles
from app.services.vocabulary import add_word, detail


NOW = datetime(2026, 10, 30, 15, tzinfo=timezone.utc)
DATA = b"1\n00:00:01,000 --> 00:00:02,000\nHello world\n"


def setup(tmp_path: Path, *, linked=False):
    db=Database(tmp_path/"data/scenelingo.db"); initialize_database(db)
    item=import_subtitle(db,filename="life.srt",data=DATA,now=lambda:NOW)
    with db.connection() as conn: cue=conn.execute("SELECT id FROM cue").fetchone()[0]
    word=None
    if linked: word=add_word(db,subtitle_id=item.subtitle.id,cue_id=cue,token_key="hello",now=lambda:NOW)["learning_item_id"]
    return db,item.subtitle.id,cue,word


def counts(db):
    with db.connection() as conn:
        return tuple(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("subtitle","cue","subtitle_token","learning_item","context_ref"))


def test_archive_and_restore_only_change_visibility(tmp_path):
    db,sid,_,_=setup(tmp_path,linked=True); before=counts(db)
    assert change_archive(db,sid,True)["status"] == "archived"
    assert list_subtitles(db)["total"] == 0 and list_subtitles(db,status="archived")["total"] == 1
    assert counts(db) == before
    assert change_archive(db,sid,False)["status"] == "imported" and counts(db) == before


def test_unlinked_preview_and_direct_delete_remove_only_subtitle_data(tmp_path):
    db,sid,_,_=setup(tmp_path)
    assert deletion_preview(db,sid)["direct_delete_allowed"] is True
    result=delete_subtitle(db,sid,strategy="direct",confirmed=True,now=lambda:NOW)
    assert result["frozen_context_count"] == 0 and counts(db) == (0,0,0,0,0)
    assert result["library_statistics"] == {"subtitle_count":0,"token_occurrence_count":0,"unique_token_count":0}


def test_linked_direct_delete_is_blocked_without_changes(tmp_path):
    db,sid,_,_=setup(tmp_path,linked=True); before=counts(db); preview=deletion_preview(db,sid)
    assert preview["associated_context_count"] == 1 and preview["associated_learning_item_count"] == 1
    with pytest.raises(ApplicationError) as caught: delete_subtitle(db,sid,strategy="direct",confirmed=True)
    assert caught.value.code == "subtitle_has_associations" and counts(db) == before


def test_freeze_delete_preserves_item_complete_snapshot_and_marks_unavailable(tmp_path):
    db,sid,_,word=setup(tmp_path,linked=True)
    result=delete_subtitle(db,sid,strategy="freeze_snapshot",confirmed=True,now=lambda:NOW)
    assert result["frozen_context_count"] == 1 and counts(db) == (0,0,0,1,1)
    context=detail(db,word)["contexts"][0]
    assert context["cue_id"] is None and context["subtitle_title"] == "life"
    assert context["text"] == "Hello world" and context["start_time"] == "00:00:01.000"
    assert context["available"] is False


def test_confirmation_is_mandatory_and_cancel_changes_nothing(tmp_path):
    db,sid,_,_=setup(tmp_path); before=counts(db)
    with pytest.raises(ApplicationError) as caught: delete_subtitle(db,sid,strategy="direct",confirmed=False)
    assert caught.value.code == "deletion_confirmation_required" and counts(db) == before


def test_injected_freeze_failure_rolls_back_everything(tmp_path):
    db,sid,_,word=setup(tmp_path,linked=True); before=counts(db)
    class Failing(SubtitleLifecycleRepository):
        def delete(self, subtitle_id): raise RuntimeError("injected")
    with pytest.raises(RuntimeError): delete_subtitle(db,sid,strategy="freeze_snapshot",confirmed=True,repository_type=Failing)
    assert counts(db) == before and detail(db,word)["contexts"][0]["available"] is True


def test_deleting_one_subtitle_updates_statistics_to_remaining(tmp_path):
    db,sid,_,_=setup(tmp_path)
    second=import_subtitle(db,filename="second.srt",data=DATA.replace(b"world",b"again"),now=lambda:NOW)
    result=delete_subtitle(db,sid,strategy="direct",confirmed=True)
    assert result["library_statistics"] == {"subtitle_count":1,"token_occurrence_count":2,"unique_token_count":2}
    assert list_subtitles(db)["items"][0]["id"] == second.subtitle.id


def test_missing_and_concurrent_delete_are_classified(tmp_path):
    db,sid,_,_=setup(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(delete_subtitle,db,sid,strategy="direct",confirmed=True) for _ in range(2)]
    outcomes=[]
    for future in futures:
        try: outcomes.append("deleted" if future.result()["deleted"] else "other")
        except ApplicationError as exc: outcomes.append(exc.code)
    assert sorted(outcomes) == ["deleted","subtitle_not_found"] and counts(db)==(0,0,0,0,0)


def test_lifecycle_api_requires_confirmation_and_returns_classified_results(tmp_path):
    app=create_app(Settings(data_dir=tmp_path/"api"),clock=lambda:NOW)
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        subtitle=import_subtitle(client.app.state.database,filename="api.srt",data=DATA,now=lambda:NOW).subtitle
        headers={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token,"Content-Type":"application/json"}
        assert client.post(f"/api/v1/subtitles/{subtitle.id}/archive",headers=headers,json={}).json()["status"] == "archived"
        assert client.post(f"/api/v1/subtitles/{subtitle.id}/restore",headers=headers,json={}).json()["status"] == "imported"
        preview=client.get(f"/api/v1/subtitles/{subtitle.id}/deletion-preview",headers=headers)
        assert preview.status_code == 200 and preview.json()["direct_delete_allowed"] is True
        refused=client.post(f"/api/v1/subtitles/{subtitle.id}/delete",headers=headers,json={"strategy":"direct","confirmed":False})
        assert refused.status_code == 422 and refused.json()["error"]["code"] == "deletion_confirmation_required"
        deleted=client.post(f"/api/v1/subtitles/{subtitle.id}/delete",headers=headers,json={"strategy":"direct","confirmed":True})
        assert deleted.status_code == 200 and deleted.json()["deleted"] is True
