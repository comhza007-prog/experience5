#ifndef DIAG_TEST_EXPORT_H
#define DIAG_TEST_EXPORT_H
static unsigned export_values(const e5_state *s,const e5_output *o,double *v) {
    unsigned p=0,ch,n,j;
    for(ch=0;ch<2;ch++) {
        v[p++]=o->requested[ch];v[p++]=o->current[ch];v[p++]=o->sigma[ch];
        v[p++]=o->dhat[ch];v[p++]=o->sector[ch];v[p++]=o->norm[ch];v[p++]=o->novelty[ch];
        v[p++]=o->ca_base[ch];v[p++]=o->ca_guarded_base[ch];v[p++]=o->ca_delta[ch];v[p++]=o->ca_before_guard[ch];
        v[p++]=s->aw[ch];v[p++]=s->k2[ch];v[p++]=s->ca_delta[ch];
        v[p++]=s->net[ch].count;v[p++]=s->net[ch].projections;
        for(n=0;n<E5_MAX_NODES;n++) {
            for(j=0;j<5;j++)v[p++]=s->net[ch].center[n][j];
            for(j=0;j<3;j++){v[p++]=s->net[ch].weight[n][j];v[p++]=s->features[ch][n][j];}
        }
    }
    v[p++]=o->gate;v[p++]=o->learning_gate;v[p++]=o->ca_mask;v[p++]=o->ca_speed_mask;
    v[p++]=s->gate;v[p++]=s->step;v[p++]=s->growth;v[p++]=s->ca_fallbacks;v[p++]=s->ca_contractions;v[p++]=s->fault;
    return p;
}
#endif
