import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import os
os.environ['PYTHONPATH'] = str(Path(__file__).resolve().parents[1]) + os.pathsep + os.environ.get('PYTHONPATH','')
