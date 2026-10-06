module.exports = ({config}) => {
  const variant=process.env.APP_VARIANT ?? 'combined';
  if(!['customer','driver','combined'].includes(variant))throw Error('APP_VARIANT must be customer, driver or combined');
  const localDemo=process.env.EXPO_PUBLIC_LOCAL_DEMO==='true';
  return {...config,name:variant==='combined'?'Velox Demo':`Velox ${variant==='customer'?'Customer':'Driver'}`,
    slug:`velox-${variant}`,scheme:`velox-${variant}`,userInterfaceStyle:'light',icon:`./assets/images/velox-${variant==='driver'?'driver':'customer'}.png`,
    android:{...config.android,package:`com.chande.${variant}`,adaptiveIcon:{backgroundColor:variant==='driver'?'#0b1c30':'#00685f',foregroundImage:`./assets/images/velox-${variant==='driver'?'driver':'customer'}-foreground.png`,monochromeImage:`./assets/images/velox-${variant==='driver'?'driver':'customer'}-foreground.png`}},
    extra:{...config.extra,appRole:variant},
    plugins:[...(config.plugins??[]).filter(p=>!['expo-build-properties','@maplibre/maplibre-react-native'].includes(typeof p==='string'?p:p[0])), '@maplibre/maplibre-react-native','./plugins/with-native-build-budget',['expo-build-properties',{android:{usesCleartextTraffic:localDemo}}]],
  };
};
