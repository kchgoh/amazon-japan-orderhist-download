SRC_ALL = $(shell find $(SRC_DIR) -type f)
SRC_ALL_REL_PATH = $(patsubst $(SRC_DIR)/%,%,$(SRC_ALL))
SRC_DIR = src
OUT_DIR = out
MANIFEST_FILE = manifest.json

all: build_firefox build_chrome

build_firefox: $(SRC_ALL)
	cd $(SRC_DIR); \
	7z a ../$(OUT_DIR)/firefox.zip $(SRC_ALL_REL_PATH)

build_chrome: $(SRC_ALL)
	cd $(SRC_DIR); \
	7z a ../$(OUT_DIR)/chrome.zip $(SRC_ALL_REL_PATH); \

clean:
	rm $(OUT_DIR)/*