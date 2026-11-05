"""Métadonnées JPEG entièrement synthétiques : pas de compte, de photo personnelle ni de bibliothèque graphique."""
import contextlib,hashlib,io,json,pathlib,re,struct,subprocess,tempfile,unittest
from unittest.mock import patch
import check_publication as check

def segment(marker,value):
    """Construit un segment JPEG sans pixels pour isoler le contrôle des métadonnées."""
    return b'\xff'+bytes([marker])+struct.pack('>H',len(value)+2)+value

def jpeg(*segments):
    """Encadre des métadonnées synthétiques par les marqueurs de début et de fin JPEG."""
    return b'\xff\xd8'+b''.join(segments)+b'\xff\xd9'

def exif(entries,endian='<'):
    """Construit un IFD TIFF de valeurs simples ; les offsets sont relatifs à son en-tête."""
    body=bytearray((b'II' if endian=='<' else b'MM')+struct.pack(endian+'HI',42,8))
    body+=struct.pack(endian+'H',len(entries))
    extra=bytearray();start=8+2+12*len(entries)+4
    for tag,kind,value in entries:
        count=len(value)//({3:2,4:4}.get(kind,1))
        stored=value.ljust(4,b'\0') if len(value)<=4 else struct.pack(endian+'I',start+len(extra))
        body+=struct.pack(endian+'HHI',tag,kind,count)+stored
        if len(value)>4:extra+=value
    body+=struct.pack(endian+'I',0)+extra
    return segment(0xE1,b'Exif\0\0'+body)

def extended_chunks(content,cuts):
    """Coupe un paquet XMP, y compris au milieu d’un motif, en segments correctement référencés."""
    guid=hashlib.md5(content,usedforsecurity=False).hexdigest().upper().encode()
    result=[];start=0
    for end in [*cuts,len(content)]:
        header=b'http://ns.adobe.com/xmp/extension/\0'+guid+struct.pack('>II',len(content),start)
        result.append(segment(0xE1,header+content[start:end]));start=end
    return result

class JpegPublication(unittest.TestCase):
    """Les variantes d’encodage ne doivent ni cacher un motif privé ni le révéler dans les diagnostics."""
    def reasons(self,data,marker='fixture-image-marker'):
        """Examine un JPEG temporaire avec un motif fictif configuré pour ce seul scénario."""
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);(root/'image.jpg').write_bytes(data)
            return check.inspect_file(root,'image.jpg',[re.compile(marker.encode())])
    def test_ascii_and_unicode_exif(self):
        """Artist, Copyright, UTF-8, XP et UserComment sont lus dans les deux ordres d’octets TIFF."""
        marker='fixture-équipe'
        for endian in ['<','>']:
            for tag,kind,value in [
                (0x013B,2,marker.encode('latin-1')+b'\0'),
                (0x8298,2,marker.encode()+b'\0'),
                (0x010E,129,marker.encode()+b'\0'),
                (0x9C9C,1,marker.encode('utf-16-le')+b'\0\0'),
                (0x9286,7,b'UNICODE\0'+marker.encode('utf-16-le' if endian=='<' else 'utf-16-be')),
            ]:
                with self.subTest(tag=tag,endian=endian):
                    self.assertIn('private pattern',self.reasons(jpeg(exif([(tag,kind,value)],endian)),marker))
    def test_exif_ascii_user_comment(self):
        """Le préfixe ASCII du commentaire EXIF n’est pas confondu avec son contenu."""
        value=b'ASCII\0\0\0fixture-image-marker'
        self.assertIn('private pattern',self.reasons(jpeg(exif([(0x9286,7,value)]))))
    def test_comments_utf8_and_utf16(self):
        """Un commentaire JPEG peut porter une valeur privée même lorsqu’il n’est pas en ASCII."""
        for encoding in ['utf-8','utf-16','utf-16-le','utf-16-be']:
            with self.subTest(encoding=encoding):
                self.assertIn('private pattern',self.reasons(jpeg(segment(0xFE,'fixture-image-marker'.encode(encoding)))))
    def test_xmp_text_and_attributes_decode_xml_entities(self):
        """Le texte et les attributs XMP échappés sont contrôlés après résolution des entités XML numériques."""
        for content in [b'<x>fixture-image-&#109;arker</x>',b'<x name="fixture-image-&#x6d;arker"/>']:
            self.assertIn('private pattern',self.reasons(jpeg(segment(0xE1,b'http://ns.adobe.com/xap/1.0/\0'+content))))
    def test_extended_xmp_reassembles_out_of_order_chunks(self):
        """Un motif séparé entre segments reste détectable, même si les segments sont réordonnés."""
        content=b'<x>fixture-image-marker</x>';chunks=extended_chunks(content,[12,19])
        self.assertIn('private pattern',self.reasons(jpeg(*reversed(chunks))))
    def test_metadata_between_progressive_scans_is_inspected(self):
        """Les octets échappés et marqueurs de redémarrage ne doivent pas masquer un commentaire après un scan."""
        data=jpeg(segment(0xDA,b'\0')+b'pixels\xff\x00more\xff\xd0',segment(0xFE,b'fixture-image-marker'),segment(0xDA,b'\0')+b'pixels')
        self.assertIn('private pattern',self.reasons(data))
    def test_clean_metadata_remains_allowed(self):
        """Des métadonnées techniques et un commentaire fictif sans données privées restent publiables."""
        data=jpeg(exif([(0x013B,2,b'Illustration fictive\0')]),segment(0xFE,b'demonstration'),segment(0xE1,b'http://ns.adobe.com/xap/1.0/\0<x>demo</x>'))
        self.assertFalse(self.reasons(data))
    def test_truncated_segments_invalid_offsets_and_cycles_fail_closed(self):
        """Une analyse EXIF ou JPEG incomplète ne doit pas être présentée comme un contrôle réussi."""
        cycle=(b'II'+struct.pack('<HIH',42,8,0)+struct.pack('<I',8))
        bad_offset=b'II'+struct.pack('<HI',42,99)
        for data in [b'\xff\xd8\xff\xe1\x00\x20short',jpeg(segment(0xE1,b'Exif\0\0'+bad_offset)),jpeg(segment(0xE1,b'Exif\0\0'+cycle)),jpeg(segment(0xFE,b'demo'))[:-2]]:
            with self.assertRaises(ValueError):check.jpeg_text(data)
    def test_extended_xmp_missing_or_overlapping_chunk_is_rejected(self):
        """Une portion manquante ou dupliquée ne permet pas de contourner la reconstitution du texte."""
        chunks=extended_chunks(b'<x>fixture-image-marker</x>',[12])
        for data in [jpeg(chunks[0]),jpeg(chunks[0],chunks[0],chunks[1])]:
            with self.assertRaises(ValueError):check.jpeg_text(data)
    def test_oversized_metadata_and_xml_entities_are_rejected(self):
        """La taille est bornée et les DTD ne sont jamais interprétées, même sans accès réseau."""
        chunks=extended_chunks(b'<x>demo</x>',[])
        with patch.object(check,'METADATA_LIMIT',4):
            with self.assertRaises(ValueError):check.jpeg_text(jpeg(*chunks))
        content=b'<!DOCTYPE x [<!ENTITY a "fixture">]><x>&a;</x>'
        with self.assertRaises(ValueError):check.jpeg_text(jpeg(segment(0xE1,b'http://ns.adobe.com/xap/1.0/\0'+content)))
    def test_gps_metadata_is_private_without_text_pattern(self):
        """Des coordonnées numériques sont privées même sans correspondance avec les motifs textuels."""
        with self.assertRaises(ValueError):check.jpeg_text(jpeg(exif([(0x8825,4,struct.pack('<I',26))])))
        content=b'<x xmlns:exif="urn:fixture" exif:GPSLatitude="1,2,3"/>'
        with self.assertRaises(ValueError):check.jpeg_text(jpeg(segment(0xE1,b'http://ns.adobe.com/xap/1.0/\0'+content)))
    def test_private_value_is_never_printed(self):
        """Le diagnostic indique seulement image et catégorie, y compris avec un commentaire Unicode."""
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);subprocess.run(['git','init','-q',str(root)],check=True,capture_output=True)
            (root/'image.jpg').write_bytes(jpeg(segment(0xFE,'fixture-image-marker'.encode('utf-16'))))
            stream=io.StringIO()
            with patch.dict('os.environ',{check.PRIVATE_ENV:json.dumps(['fixture-image-marker'])},clear=True),contextlib.redirect_stdout(stream):code=check.main(root)
            self.assertEqual(code,1);self.assertIn('private pattern',stream.getvalue());self.assertNotIn('fixture-image-marker',stream.getvalue())
