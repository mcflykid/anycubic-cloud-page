"""Vérifie la rétention du journal et le filtrage des données hors transport Anycubic."""
import json
import tempfile
import time
import unittest
from pathlib import Path
from command_journal import CommandJournal, make_entry

class CommandJournalTests(unittest.TestCase):
 """Construit des traces fictives pour tester les limites du fichier persistant."""
 def test_rotates_by_age_and_size(self):
  """Les entrées trop anciennes ou trop volumineuses cèdent la place à la dernière."""
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'journal.jsonl'
   journal=CommandJournal(path,max_bytes=550,max_age=60)
   row=make_entry('print-local','fixture-request-old','printer-test','Imprimante',b'test','127.0.0.1',{})
   old_id=row['request_id'];row['time']=time.time()-61
   path.write_text(json.dumps(row)+'\n')
   for index in range(10):
    row=make_entry('print-local',f'fixture-request-{index}', 'printer-test','Imprimante',b'test','127.0.0.1',{'name':f'Pièce {index}.gcode'})
    journal.record(row)
   rows=journal.rows()
   self.assertLessEqual(path.stat().st_size,550)
   self.assertLess(len(rows),10)
   self.assertEqual(rows[-1]['parameters']['name'],'Pièce 9.gcode')
   self.assertNotIn(old_id,path.read_text())
 def test_fields_with_sensitive_values_are_not_recorded(self):
  """Seuls les paramètres autorisés entrent dans une trace."""
  data={'name':'fixture@example.test','temperature':215,'slots':[1,3],'ticket':'private-ticket',
   'id':1234,'password':'fixture-secret','url':'https://example.test/fixture'}
  row=make_entry('print-local','opaque-reference-test','printer-test','https://example.test/account',None,'unknown',data)
  self.assertEqual(row['parameters'],{'temperature':215,'slots':[1,3]})
  self.assertIsNone(row['printer_name'])
  self.assertIsNone(row['client'])
  self.assertNotEqual(row['request_id'],'opaque-reference-test')
