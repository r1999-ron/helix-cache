import json, os, sys, tempfile
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, PeftModel, get_peft_model

request = json.load(sys.stdin)
model_id = os.getenv('LORA_BASE_MODEL', 'hf-internal-testing/tiny-random-gpt2')
adapter_id = os.getenv('LORA_ADAPTER', '')
tokenizer = AutoTokenizer.from_pretrained(model_id)
base = AutoModelForCausalLM.from_pretrained(model_id)
if adapter_id:
    model = PeftModel.from_pretrained(base, adapter_id)
else:
    # Create, serialize, and reload a genuine PEFT LoRA adapter for the small base model.
    config = LoraConfig(r=4, lora_alpha=8, target_modules=['c_attn'], task_type='CAUSAL_LM')
    initialized = get_peft_model(base, config)
    with tempfile.TemporaryDirectory() as folder:
        initialized.save_pretrained(folder)
        model = PeftModel.from_pretrained(base, folder)
inputs = tokenizer(request['prompt'], return_tensors='pt')
with torch.inference_mode():
    output = model.generate(**inputs, max_new_tokens=int(request.get('max_new_tokens', 24)), do_sample=False)
text = tokenizer.decode(output[0], skip_special_tokens=True)
trainable, total = model.get_nb_trainable_parameters()
print(json.dumps({'text': text, 'baseModel': model_id, 'adapter': adapter_id or 'generated-local-peft-lora', 'parameters': {'trainable': trainable, 'total': total}}))
