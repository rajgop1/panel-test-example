importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.3/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.3/dist/wheels/panel-0.14.3-py3-none-any.whl', 'pyodide-http==0.1.0', 'holoviews>=1.15.4', 'hvplot', 'numpy', 'pandas']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

#!/usr/bin/env python
# coding: utf-8

# In[1]:


import pandas as pd
import numpy as np
import panel as pn
pn.extension('tabulator')
import hvplot.pandas


# In[2]:


df = pd.read_excel('/Reports.xlsx', sheet_name='Sheet1')


# In[3]:


# df['WATER CONTENT%'] = df['WATER CONTENT%'] / df['WATER CONTENT%'].sum() * 100


# In[4]:


table = df[['WELL', 'Asset', 'OIL(M3/DAY)', 'OIL(MT/DAY)', 'WATER CONTENT%', 'Year', 'Month']]


# In[5]:


table = table.reset_index(drop=True)


# In[6]:


Asset_select = pn.widgets.Select(name='Asset', options=sorted(df['Asset'].dropna().unique().tolist()))
Year_select = pn.widgets.Select(name='Year', options=sorted(df['Year'].dropna().unique().tolist()))
Month_select = pn.widgets.Select(name='Month', options=sorted(df['Month'].dropna().unique().tolist()))


# In[7]:


# table['cumulative_sum'] = table['WATER CONTENT%'].cumsum()
# threshold = table['WATER CONTENT%'].sum() * 0.8
# table = table[table['cumulative_sum'] <= threshold]

# total = table['WATER CONTENT%'].sum()
# new_row = pd.DataFrame({'WELL': ['Total'], 'WATER CONTENT%': [total]})
# table = pd.concat([table, new_row], ignore_index=True)
table.sort_values(by='WATER CONTENT%', ascending=False, inplace=True)
itable = table.interactive()


# In[8]:


# sort_water = pn.widgets.Button(name='Sort by WATER CONTENT%', button_type='primary')
# sort_oil = pn.widgets.Button(name='Sort by OIL(M3/DAY)', button_type='primary')


# In[9]:


pipeline = (
        itable[
            (itable["Asset"] == Asset_select) &
            (itable.Year == Year_select) &
            (itable.Month == Month_select) 
        ]
    ).assign(WATER_CONTENT_PCT=lambda x: x["WATER CONTENT%"]/x["WATER CONTENT%"].mean()*100,
             OILM3perDAY=lambda x: x["OIL(M3/DAY)"]/x["OIL(M3/DAY)"].sum()*100,
             OILMTperDAY=lambda x: x["OIL(MT/DAY)"]/x["OIL(MT/DAY)"].mean()*100)
pipeline = pipeline.drop(["WATER CONTENT%", "OIL(M3/DAY)", "OIL(MT/DAY)"], axis=1).rename(columns={"WATER_CONTENT_PCT": "WATER CONTENT%", "OILM3perDAY": "OIL(M3/DAY)", "OILMTperDAY":"OIL(MT/DAY)"}).sort_values(by="OIL(M3/DAY)", ascending=False)


# In[10]:


well_itable = pipeline.pipe(pn.widgets.Tabulator, pagination='remote', page_size = 10, sizing_mode='stretch_width') 


# In[11]:


well_select = pn.widgets.Select(name='WELL', options=sorted(df['WELL'].dropna().unique().tolist()))


# In[12]:


well_select


# In[13]:


pipeline_chart = (
        itable[
            (itable["Asset"] == Asset_select) &
            (itable.WELL == well_select) 
        ]
    )


# In[14]:


plot = pipeline_chart.hvplot(x='Year', y='WATER CONTENT%',  title='Well Water Oil% ')


# In[15]:


plot


# In[16]:


template = pn.template.FastListTemplate(
    title='OIL dashboard', 
    main=[pn.Row(pn.Column(well_itable, 
                           plot.panel(width=1000), margin=(0,25)), 
                )],
    accent_base_color="#88d8b0",
    header_background="#88d8b0",
)
# template.show()
template.servable()



await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()
